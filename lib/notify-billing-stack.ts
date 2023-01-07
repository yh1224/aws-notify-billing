import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as events_targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import {IAMClient, ListAccountAliasesCommand} from "@aws-sdk/client-iam";
import {Construct} from "constructs";
import {Context} from "./Context";

interface AwsBillingStackProps extends cdk.StackProps {
    readonly context: Context,
    readonly accountAliases: string[];
}

class NotifyBillingStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: AwsBillingStackProps) {
        super(scope, id, props);

        const {account} = cdk.Stack.of(this);
        const context = props.context;

        const notifyBillingTopic = new sns.Topic(this, "NotifyBillingTopic", {});

        const notifyBillingFunc = new lambda_nodejs.NodejsFunction(this, "NotifyBillingFunc", {
            architecture: lambda.Architecture.ARM_64,
            entry: "src/lambdas/NotifyBillingFunc/index.ts",
            environment: {
                ACCOUNT_NAME: account + (props.accountAliases.length > 0 ? `(${props.accountAliases[0]})` : ""),
                NOTIFY_TOPIC_ARN: notifyBillingTopic.topicArn,
                SLACK_WEBHOOK_URL: context.slackWebhookUrl || "",
            },
            handler: "lambda_handler",
            logRetention: logs.RetentionDays.ONE_WEEK,
            runtime: lambda.Runtime.NODEJS_18_X,
            timeout: cdk.Duration.minutes(1),
        });
        notifyBillingTopic.grantPublish(notifyBillingFunc);
        notifyBillingFunc.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["ce:GetCostAndUsage"],
            resources: ["*"],
        }));
        new events.Rule(this, "Schedule", {
            schedule: events.Schedule.cron({minute: "55", hour: "23"}), // 08:55 JST
            targets: [new events_targets.LambdaFunction(notifyBillingFunc)],
        });
    }
}

export async function createNotifyBillingStack(scope: Construct, id: string, context: Context): Promise<cdk.Stack> {
    return new NotifyBillingStack(scope, id, {
        env: context.env,
        context,
        accountAliases: await getAccountAliases(),
    });
}

async function getAccountAliases(): Promise<string[]> {
    const iam = new IAMClient({});
    return (await iam.send(new ListAccountAliasesCommand({}))).AccountAliases!;
}
