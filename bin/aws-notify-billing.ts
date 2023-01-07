#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import {createContext} from "../lib/Context";
import {createNotifyBillingStack} from "../lib/notify-billing-stack";

const app = new cdk.App();
const context = createContext(app.node.tryGetContext("env") || process.env.ENV);

(async () => {
    await createNotifyBillingStack(app, "NotifyBilling", context);
})();
