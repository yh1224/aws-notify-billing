# AWS Notify Billing

Notify AWS billing everyday.

## Deploy

```shell
sam build (--use-container)
sam deploy (--guided)
```

### Parameters

|Name|Default|Description|
|:--|:--|:--|
|SlackWebhookUrl|(none)|Slack Webhook URL to notify. (can be ommitted)|
