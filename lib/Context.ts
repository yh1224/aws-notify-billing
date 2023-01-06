import * as cdk from "aws-cdk-lib";
import * as fs from "fs";

interface Context {
    /**
     * AWS Environment
     */
    readonly env?: cdk.Environment;

    /**
     * Slack Webhook URL
     */
    readonly slackWebhookUrl?: string;
}

/**
 * Create Context.
 *
 * @param env Environment name
 */
function createContext(env?: string): Context {
    return JSON.parse(fs.readFileSync(`context${env ? `.${env}` : ""}.json`).toString());
}

export {Context, createContext}
