#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import {NotifyBillingStack} from "../lib/notify-billing-stack";
import {createContext} from "../lib/Context";

const app = new cdk.App();
const context = createContext(app.node.tryGetContext("env") || process.env.ENV);

new NotifyBillingStack(app, "NotifyBilling", {
    env: context.env,
    context,
});
