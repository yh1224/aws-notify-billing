#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import {createConfig} from "../lib/config";
import {createNotifyBillingStack} from "../lib/notify-billing-stack";

const app = new cdk.App();
const config = createConfig(app.node.tryGetContext("env") || process.env.ENV);

(async () => {
    await createNotifyBillingStack(app, "NotifyBilling", config);
})();
