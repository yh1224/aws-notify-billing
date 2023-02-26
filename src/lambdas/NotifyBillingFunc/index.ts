import {Context, Handler} from "aws-lambda";
import {CostExplorerClient, GetCostAndUsageCommand} from "@aws-sdk/client-cost-explorer";
import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";
import fetch from "node-fetch";

const ACCOUNT_NAME = process.env.ACCOUNT_NAME || "";
const NOTIFY_TOPIC_ARN = process.env.NOTIFY_TOPIC_ARN || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

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

async function getBilling(startDay: Date, endDay: Date): Promise<Record<string, any>> {
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
                Key: "SERVICE",
            }
        ],
    }));

    const perService: Record<string, number> = {};
    for (const resultByTime of response.ResultsByTime!) {
        for (const group of resultByTime.Groups!) {
            const serviceName = group.Keys![0]!;
            const amount = parseFloat(group.Metrics!["AmortizedCost"].Amount!);
            if (!(serviceName in perService)) {
                perService[serviceName] = 0;
                perService[serviceName] += amount;
            }
        }
    }

    return {
        "start": startDay.toISOString(),
        "end": endDay.toISOString(),
        "perService": perService,
    }
}


async function getMessage(billing: Record<string, any>): Promise<[string, string]> {
    const month = (new Date(billing["start"])).toISOString().substring(0, 7);
    const billingPerService: Record<string, number> = billing["perService"];

    // total
    const totalSum = Object.values(billingPerService).reduce((acc, v) => acc + v, 0);
    const title = `${ACCOUNT_NAME}: Current AWS cost for ${month} is ${totalSum.toFixed(2)} USD.`;

    // per service
    const perService: Record<string, string | number>[] = [];
    let tax: number | null = null;
    for (const [serviceName, amount] of Object.entries(billingPerService)) {
        if (serviceName == "Tax") {
            tax = amount;
            continue;
        }
        if (amount.toFixed(1) == "0.0") {
            continue;
        }
        const detail = `- ${serviceName}: ${amount.toFixed(2)} USD`;
        perService.push({"amount": amount, "detail": detail});
    }
    let message: string;
    if (perService.length > 0) {
        // sort by amount in descending order
        perService.sort((a, b) => (b["amount"] as number) - (a["amount"] as number));
        message = perService.map(x => x["detail"]).join("\n");
        if (tax) {
            message += `\n- Tax: ${tax.toFixed(2)} USD`;
        }
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
