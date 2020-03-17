import json
import os
from datetime import date
from datetime import datetime, timedelta

import boto3
import requests

NOTIFY_TOPIC_ARN = os.environ['NOTIFY_TOPIC_ARN']
SLACK_WEBHOOK_URL = os.environ['SLACK_WEBHOOK_URL']

ce_client = boto3.client('ce', region_name='us-east-1')


def lambda_handler(event, context):
    target_day = date.today()
    if target_day.day == 1:
        target_day - timedelta(days=1)
    start_day = date(target_day.year, target_day.month, 1)
    end_day = target_day + timedelta(days=1)
    billing = get_billing(ce_client, start_day, end_day)

    (title, message) = get_message(billing)
    notify(title, message)


def get_billing(client, start_day, end_day):
    # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ce.html#CostExplorer.Client.get_cost_and_usage
    response = client.get_cost_and_usage(
        TimePeriod={
            'Start': start_day.isoformat(),
            'End': end_day.isoformat()
        },
        Granularity='MONTHLY',
        Metrics=[
            'AmortizedCost'
        ],
        GroupBy=[
            {
                'Type': 'DIMENSION',
                'Key': 'SERVICE'
            }
        ]
    )

    per_service = {}
    for result_by_time in response['ResultsByTime']:
        for group in result_by_time['Groups']:
            service_name = group['Keys'][0]
            amount = float(group['Metrics']['AmortizedCost']['Amount'])
            if service_name not in per_service:
                per_service[service_name] = 0
            per_service[service_name] += amount

    return {
        'start': start_day.isoformat(),
        'end': end_day.isoformat(),
        'per_service': per_service
    }


def get_message(billing):
    month = datetime.strptime(billing['start'], '%Y-%m-%d').strftime('%Y/%m')
    billing_per_service = billing['per_service']

    # total
    total_sum = sum(billing_per_service.values())
    title = f'Current AWS cost for {month} is {total_sum:.2f} USD.'

    # per service
    per_service = []
    tax = None
    for service_name, amount in billing_per_service.items():
        if service_name == 'Tax':
            tax = amount
            continue
        if round(amount, 2) == 0.0:
            continue
        detail = f'- {service_name}: {amount:.2f} USD'
        per_service.append({'amount': amount, 'detail': detail})
    # sort by amount in descending order
    per_service = sorted(per_service, key=lambda x: x['amount'], reverse=True)
    message = '\n'.join(map(lambda x: x['detail'], per_service))
    if tax is not None:
        message += f'\n- Tax: {tax:.2f} USD'

    return title, message


def notify(title, message):
    if len(NOTIFY_TOPIC_ARN) > 0:
        notify_sns(NOTIFY_TOPIC_ARN, title, message)
    if len(SLACK_WEBHOOK_URL) > 0:
        notify_slack(SLACK_WEBHOOK_URL, title, message)


def notify_slack(url, title, message):
    requests.post(url, data=json.dumps({
        'attachments': [
            {
                'color': '#36a64f',
                'pretext': title,
                'text': message
            }
        ]
    }))


def notify_sns(topic, title, message):
    sns_client = boto3.client('sns')
    sns_client.publish(
        TopicArn=topic,
        Subject=title,
        Message=message
    )
