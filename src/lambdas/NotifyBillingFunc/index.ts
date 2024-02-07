import {Context, Handler} from "aws-lambda";
import {CostExplorerClient, GetCostAndUsageCommand, GetDimensionValuesCommand} from "@aws-sdk/client-cost-explorer";
import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";
import fetch from "node-fetch";

const TITLE = process.env.TITLE || "";
const NOTIFY_TOPIC_ARN = process.env.NOTIFY_TOPIC_ARN || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const GROUP_BY = process.env.GROUP_BY || "";

export const lambda_handler: Handler = async (event, context: Context) => {
    const targetDay = new Date();
    if (targetDay.getDate() == 1) {
        targetDay.setDate(targetDay.getDate() - 1);
    }
    const startDay = new Date(Date.UTC(targetDay.getFullYear(), targetDay.getMonth(), 1));
    const endDay = new Date(Date.UTC(targetDay.getFullYear(), targetDay.getMonth() + 1, 1));
    const billing = await getBilling(startDay, endDay);

    const [title, message] = await getMessage(billing);
    await notify(title, message);
}

type BillingByGroup = {
    readonly name: string;
    readonly description?: string;
    readonly amount: number;
}

type BillingInfo = {
    readonly start: string;
    readonly end: string;
    readonly amount: number;
    readonly byGroup: BillingByGroup[];
}

async function getBilling(startDay: Date, endDay: Date): Promise<BillingInfo> {
    const ceClient = new CostExplorerClient({});
    const response = await ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: {
            Start: startDay.toISOString().split("T")[0],
            End: endDay.toISOString().split("T")[0],
        },
        Granularity: "MONTHLY",
        Metrics: [
            "AmortizedCost",
        ],
        GroupBy: [
            {
                Type: "DIMENSION",
                Key: GROUP_BY,
            }
        ],
    }));
    process.stdout.write(`${JSON.stringify(response)}\n`);

    // get descriptions
    const descriptions = Object.fromEntries(response.DimensionValueAttributes
        ?.map(v => [v.Value!, v.Attributes!["description"]]) || []);

    // aggregate by group
    const amountByGroup: Record<string, number> = {};
    let total = 0;
    let tax: number | null = null;
    for (const resultByTime of response.ResultsByTime!) {
        for (const group of resultByTime.Groups!) {
            const groupKey = group.Keys![0]!;
            const amount = parseFloat(group.Metrics!["AmortizedCost"].Amount!);
            total += amount;
            if (groupKey == "Tax") {
                tax = amount;
                continue;
            }
            if (!(groupKey in amountByGroup)) {
                amountByGroup[groupKey] = 0;
                amountByGroup[groupKey] += amount;
            }
        }
    }
    const billingByGroup = Object.keys(amountByGroup)
        .map(groupKey => ({
            name: groupKey,
            description: descriptions[groupKey],
            amount: amountByGroup[groupKey],
        }));
    // sort by amount in descending order
    billingByGroup.sort((a, b) => b.amount - a.amount);
    if (tax) {
        billingByGroup.push({
            name: "Tax",
            description: undefined,
            amount: tax,
        });
    }

    return {
        start: startDay.toISOString(),
        end: endDay.toISOString(),
        amount: total,
        byGroup: billingByGroup,
    }
}

function toFixed(num: number): string {
    let str = num.toFixed(2);
    if (str == "-0.00") {
        str = "0.00";
    }
    return str;
}

async function getMessage(billingInfo: BillingInfo): Promise<[string, string]> {
    const month = (new Date(billingInfo.start)).toISOString().substring(0, 7);
    const amount = billingInfo.amount;
    const byGroup = billingInfo.byGroup;

    // total
    const title = `${TITLE}: Current AWS cost for ${month} is ${toFixed(amount)} USD.`;

    // details
    const details: string[] = [];
    for (const billing of byGroup) {
        let name = billing.name;
        if (billing.description) {
            name += `(${billing.description})`;
        }
        const amountFixed = toFixed(billing.amount);
        if (amountFixed == "0.00") {
            continue;
        }
        details.push(`- ${name}: ${amountFixed} USD`);
    }
    let message: string;
    if (details.length > 0) {
        message = details.join("\n");
    } else {
        message = "- No data"
    }
    return [title, message];
}


async function notify(title: string, message: string): Promise<void> {
    if (NOTIFY_TOPIC_ARN.length > 0) {
        await notifySns(NOTIFY_TOPIC_ARN, title, message);
    }
    if (SLACK_WEBHOOK_URL.length > 0) {
        await notifySlack(SLACK_WEBHOOK_URL, title, message)
    }
}

async function notifySlack(url: string, title: string, message: string): Promise<void> {
    await fetch(url, {
        method: "POST",
        body: JSON.stringify({
            "attachments": [
                {
                    "color": "#36a64f",
                    "pretext": title,
                    "text": message
                },
            ],
        })
    })
}

async function notifySns(topicArn: string, title: string, message: string): Promise<void> {
    const snsClient = new SNSClient({});
    await snsClient.send(new PublishCommand({
        TopicArn: topicArn,
        Subject: title,
        Message: message,
    }));
}
