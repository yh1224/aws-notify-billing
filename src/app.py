import os
import boto3
import json
import requests
from datetime import datetime, timedelta
from datetime import date

TOPIC_ARN = os.environ.get('NOTIFY_ARN')
SLACK_WEBHOOK_URL = os.environ.get('SLACK_WEBHOOK_URL')


def lambda_handler(event, context):
    ce_client = boto3.client('ce', region_name='us-east-1')

    target_day = date.today()

    # 合計とサービス毎の請求額を取得する
    total_billing = get_total_billing(ce_client, target_day)
    service_billings = get_service_billings(ce_client, target_day)

    service_billings_prev = []
    if target_day.day != 2:
        prev_day = target_day - timedelta(days=1)
        service_billings_prev = get_service_billings(ce_client, prev_day)

    # 通知
    (title, message) = get_message(total_billing, service_billings, service_billings_prev)
    notify(title, message)


def get_total_billing(client, target_day):
    # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ce.html#CostExplorer.Client.get_cost_and_usage
    response = client.get_cost_and_usage(
        TimePeriod={
            'Start': get_begin_of_month(target_day).isoformat(),
            'End': target_day.isoformat()
        },
        Granularity='MONTHLY',
        Metrics=[
            'AmortizedCost'
        ]
    )
    return {
        'start': response['ResultsByTime'][0]['TimePeriod']['Start'],
        'end': response['ResultsByTime'][0]['TimePeriod']['End'],
        'billing': response['ResultsByTime'][0]['Total']['AmortizedCost']['Amount'],
    }


def get_service_billings(client, target_day):
    # https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ce.html#CostExplorer.Client.get_cost_and_usage
    response = client.get_cost_and_usage(
        TimePeriod={
            'Start': get_begin_of_month(target_day).isoformat(),
            'End': target_day.isoformat()
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

    billings = []

    for item in response['ResultsByTime'][0]['Groups']:
        billings.append({
            'service_name': item['Keys'][0],
            'billing': item['Metrics']['AmortizedCost']['Amount']
        })
    return billings


def get_message(total_billing, service_billings, service_billings_prev):
    start = datetime.strptime(total_billing['start'], '%Y-%m-%d').strftime('%m/%d')
    end_date = datetime.strptime(total_billing['end'], '%Y-%m-%d') - timedelta(days=1)
    end = end_date.strftime('%m/%d')
    total = round(float(total_billing['billing']), 2)

    title = f'{start}~{end} : Your billing amount is {total:.2f} USD.'

    bills = []
    for item in service_billings:
        service_name = item['service_name']
        billing = round(float(item['billing']), 2)
        billing_delta = None
        prev_items = [x for x in service_billings_prev if x['service_name'] == service_name]
        if len(prev_items) > 0:
            billing_prev = round(float(prev_items[0]['billing']), 2)
            billing_delta = billing - billing_prev

        if billing == 0.0:
            # 請求無し（0.0 USD）の場合は、内訳を表示しない
            continue
        if billing_delta is not None:
            detail = f'- {service_name}: {billing:.2f}(+{billing_delta:.2f}) USD'
        else:
            detail = f'- {service_name}: {billing:.2f} USD'
        bills.append({'billing': billing, 'detail': detail})
    print(bills)

    # sort by billing
    bills = sorted(bills, key=lambda x: x['billing'], reverse=True)

    message = '\n'.join(map(lambda x: x['detail'], bills))
    return title, message


def get_prev_time_period():
    yesterday = date.today() - timedelta(days=1)
    return {
        'Start': get_begin_of_month(yesterday).isoformat(),
        'End': yesterday.isoformat()
    }


def get_time_period(today):
    return {
        'Start': get_begin_of_month(today).isoformat(),
        'End': today.isoformat()
    }


def get_begin_of_month(target_day):
    if target_day.day == 1:
        target_day = target_day - timedelta(days=1)

    return date(target_day.year, target_day.month, 1)


def notify(title, message):
    print(title)
    print(message)
    if TOPIC_ARN is not None and TOPIC_ARN != 'NotifyBillingTopic':
        notify_sns(TOPIC_ARN, title, message)
    if SLACK_WEBHOOK_URL is not None and SLACK_WEBHOOK_URL != 'SlackWebhookUrl':
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
