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
    target_day = date.today() - timedelta(days=1)
    billing = get_billing(ce_client, get_begin_of_month(target_day), target_day)
    (title, message) = get_message(billing)
    notify(title, message)


def get_billing(client, start_day, end_day):
    # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ce.html#CostExplorer.Client.get_cost_and_usage
    response = client.get_cost_and_usage(
        TimePeriod={
            'Start': start_day.isoformat(),
            'End': end_day.isoformat()
        },
        Granularity='DAILY',
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

    daily = {}
    total = {}
    for result_by_time in response['ResultsByTime']:
        start_date = result_by_time['TimePeriod']['Start']
        daily[start_date] = {}
        for group in result_by_time['Groups']:
            service_name = group['Keys'][0]
            if service_name == 'Tax':  # exclude tax
                continue
            amount = float(group['Metrics']['AmortizedCost']['Amount'])
            daily[start_date][service_name] = amount
            if service_name not in total:
                total[service_name] = 0
            total[service_name] += amount

    return {
        'start': start_day.isoformat(),
        'end': end_day.isoformat(),
        'total': total,
        'daily': daily
    }


def get_message(billing):
    start = datetime.strptime(billing['start'], '%Y-%m-%d').strftime('%m/%d')
    end_date = datetime.strptime(billing['end'], '%Y-%m-%d') - timedelta(days=1)
    end = end_date.strftime('%m/%d')

    total_billing = billing['total']
    last_billing = billing['daily'][end_date.strftime('%Y-%m-%d')]

    # total
    total_sum = sum(total_billing.values())
    last_sum = sum(last_billing.values())
    title = f'{start}~{end} : Your billing amount is {total_sum:.2f}(+{last_sum:.2f}) USD.'

    # per service
    per_service = []
    for service_name, amount in total_billing.items():
        if round(amount, 2) == 0.0:
            continue
        if service_name in last_billing:
            detail = f'- {service_name}: {amount:.2f}(+{last_billing[service_name]:.2f}) USD'
        else:
            detail = f'- {service_name}: {amount:.2f} USD'
        per_service.append({'amount': amount, 'detail': detail})
    # sort by amount in descending order
    per_service = sorted(per_service, key=lambda x: x['amount'], reverse=True)
    message = '\n'.join(map(lambda x: x['detail'], per_service))

    return title, message


def get_begin_of_month(target_day):
    if target_day.day == 1:
        target_day = target_day - timedelta(days=1)

    return date(target_day.year, target_day.month, 1)


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
