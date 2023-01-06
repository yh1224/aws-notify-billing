# AWS Notify Billing

Notify AWS billing everyday.

## How to deploy

 1. Create context.json and configure

    - slackWebhookUrl : Slack Webhook URL to notify

 2. Prepare

    ```shell
    npm install -g cdk
    npm install
    cdk bootstrap
    ```

 3. Deploy stack

    ```shell
    cdk deploy
    ```
