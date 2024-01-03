import * as cdktf from "cdktf";
import {createConfig} from "./lib/config";
import {createNotifyBillingStack} from "./lib/notify-billing-stack";

const app = new cdktf.App();
const config = createConfig(app.node.tryGetContext("env") || process.env.ENV);

(async () => {
    await createNotifyBillingStack(app, "cdktf", config);
    app.synth();
})();
