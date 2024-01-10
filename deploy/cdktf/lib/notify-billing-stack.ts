import * as path from "node:path";
import * as child_process from "node:child_process";
import {IAMClient, ListAccountAliasesCommand} from "@aws-sdk/client-iam";
import * as cdktf from "cdktf";
import {AwsProvider} from "@cdktf/provider-aws/lib/provider";
import {DataAwsCallerIdentity} from "@cdktf/provider-aws/lib/data-aws-caller-identity";
import {IamRole} from "@cdktf/provider-aws/lib/iam-role";
import {CloudwatchEventRule} from "@cdktf/provider-aws/lib/cloudwatch-event-rule";
import {CloudwatchEventTarget} from "@cdktf/provider-aws/lib/cloudwatch-event-target";
import {LambdaFunction} from "@cdktf/provider-aws/lib/lambda-function";
import {LambdaPermission} from "@cdktf/provider-aws/lib/lambda-permission";
import {S3Bucket} from "@cdktf/provider-aws/lib/s3-bucket";
import {S3Object} from "@cdktf/provider-aws/lib/s3-object";
import {SnsTopic} from "@cdktf/provider-aws/lib/sns-topic";
import {RandomProvider} from "@cdktf/provider-random/lib/provider";
import {Id} from "@cdktf/provider-random/lib/id";
import {Construct} from "constructs";
import {buildSync} from "esbuild";
import {Config} from "./config";

type NotifyBillingProps = {
    readonly config: Config;
    readonly accountAliases: string[];
};

export class NotifyBillingStack extends cdktf.TerraformStack {
    constructor(scope: Construct, id: string, props: NotifyBillingProps) {
        super(scope, id);

        const {accountId} = new DataAwsCallerIdentity(this, "CallerIdentity");

        const {config} = props;
        const cron = config.cron || "55 23 * * ? *"; // 08:55 JST
        const slackWebhookUrl = config.slackWebhookUrl || "";
        const groupBy = config.groupBy || "SERVICE";

        new RandomProvider(this, "RandomProvider", {});
        const uniqueSuffix = new Id(this, "RandomId", {byteLength: 5});

        new AwsProvider(this, "AwsProvider", {
            defaultTags: [{
                tags: {
                    "cdktf:project": config.project,
                },
            }],
            region: config.env?.region,
        });
        if (config.backend?.startsWith("s3://")) {
            const paths = config.backend?.substring(5).split("/");
            const bucket = paths.shift()!;
            const key = path.join(paths.join("/"), "terraform.cdktf.tfstate");
            new cdktf.S3Backend(this, {
                bucket,
                key,
                region: config.env?.region,
            });
        }

        const notifyBillingTopic = new SnsTopic(this, "NotifyBillingTopic", {
            name: `${config.project}-NotifyBillingTopic-${uniqueSuffix.hex}`,
        });

        const notifyBillingRole = new IamRole(this, "NotifyBillingRole", {
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Action: "sts:AssumeRole",
                    Principal: {
                        Service: "lambda.amazonaws.com",
                    },
                    Effect: "Allow",
                }],
            }),
            managedPolicyArns: [
                "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            ],
            name: `${config.project}-NotifyBillingRole-${uniqueSuffix.hex}`,
            inlinePolicy: [{
                name: "NotifyBillingPolicy",
                policy: JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Action: [
                                "ce:GetCostAndUsage",
                                "ce:GetDimensionValues",
                            ],
                            Effect: "Allow",
                            Resource: "*",
                        },
                        {
                            Action: "sns:Publish",
                            Effect: "Allow",
                            Resource: notifyBillingTopic.arn,
                        }
                    ]
                }),
            }],
        });

        const bucket = new S3Bucket(this, "AssetBucket", {
            bucket: `cdktf-${config.project.toLowerCase()}-assets-${uniqueSuffix.hex}`,
        });
        const sourceDir = path.resolve(path.resolve(__dirname, "../../../src/lambdas/NotifyBillingFunc"));
        child_process.execSync(`cd ${sourceDir} && npm ci --production`);
        buildSync({
            absWorkingDir: sourceDir,
            entryPoints: ["index.ts"],
            bundle: true,
            format: "cjs",
            platform: "node",
            sourcemap: "external",
            target: "es2018",
            outdir: "dist",
        });
        const functionAsset = new cdktf.TerraformAsset(this, "lambda-asset", {
            path: path.join(sourceDir, "dist"),
            type: cdktf.AssetType.ARCHIVE,
        });
        const lambdaArchive = new S3Object(this, "FunctionAsset", {
            bucket: bucket.bucket,
            key: `${functionAsset.fileName}`,
            source: functionAsset.path,
        });
        const notifyBillingFunction = new LambdaFunction(this, "NotifyBillingFunction", {
            architectures: ["arm64"],
            environment: {
                variables: {
                    ACCOUNT_NAME: accountId + (props.accountAliases.length > 0 ? `(${props.accountAliases[0]})` : ""),
                    NOTIFY_TOPIC_ARN: notifyBillingTopic.arn,
                    SLACK_WEBHOOK_URL: slackWebhookUrl,
                    GROUP_BY: groupBy,
                },
            },
            functionName: `${config.project}-NotifyBillingFunction-${uniqueSuffix.hex}`,
            handler: "index.lambda_handler",
            runtime: "nodejs18.x",
            role: notifyBillingRole.arn,
            s3Bucket: bucket.bucket,
            s3Key: lambdaArchive.key,
            timeout: 60,
        });

        const notifyBillingEventRule = new CloudwatchEventRule(this, "NotifyBillingRule", {
            name: `${config.project}-NotifyBillingRule-${uniqueSuffix.hex}`,
            scheduleExpression: `cron(${cron})`,
        });
        new CloudwatchEventTarget(this, "NotifyBillingTarget", {
            arn: notifyBillingFunction.arn,
            rule: notifyBillingEventRule.name,
        });
        new LambdaPermission(this, "NotifyBillingPermission", {
            action: "lambda:InvokeFunction",
            functionName: notifyBillingFunction.functionName,
            principal: "events.amazonaws.com",
            sourceArn: notifyBillingEventRule.arn,
        });
    }
}

export async function createNotifyBillingStack(scope: Construct, id: string, config: Config): Promise<cdktf.TerraformStack> {
    return new NotifyBillingStack(scope, id, {
        config,
        accountAliases: await getAccountAliases(),
    });
}

async function getAccountAliases(): Promise<string[]> {
    const iam = new IAMClient({});
    return (await iam.send(new ListAccountAliasesCommand({}))).AccountAliases!;
}
