import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

type StackProps = cdk.StackProps & {
  stripePartnerEventBusArn: string;
};

export class StripeCdkPracticeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    //
    // EventBridge EventBuses
    //

    // アプリケーション内部からイベントを送る EventBus（例：カスタムイベント）
    const internalEventBus = new events.EventBus(this, 'InternalEventBus', {
      eventBusName: 'InternalEventBus',
    });

    // イベント処理を集約するメイン EventBus（Stripeイベントもここに集約）
    const processingEventBus = new events.EventBus(this, 'ProcessingEventBus', {
      eventBusName: 'ProcessingEventBus',
    });

    // Stripe Partner EventBus（すでに存在する外部 EventBus）
    const stripePartnerEventBus = events.EventBus.fromEventBusArn(
      this,
      'StripePartnerEventBus',
      props.stripePartnerEventBusArn
    );

    //
    // SQS Queue for processing events
    //

    // Stripeイベントの処理用キュー
    const stripeEventQueue = new sqs.Queue(this, 'StripeEventQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    //
    // Lambda Function to process SQS events
    //

    const stripeEventProcessorFunction = new lambda.Function(this, 'StripeEventProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log("Lambda triggered by SQS:", JSON.stringify(event));
          return { statusCode: 200, body: "OK" };
        };
      `),
    });

    //
    // IAM Roles for EventBridge targets
    //

    // EventBridge → ProcessingEventBus に PutEvents するためのロール
    const eventBridgeToProcessingBusRole = new iam.Role(this, 'EventBridgeToProcessingBusRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    });

    eventBridgeToProcessingBusRole.addToPolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [processingEventBus.eventBusArn],
    }));

    // EventBridge → SQS に送信するためのロール
    const eventBridgeToSqsRole = new iam.Role(this, 'EventBridgeToSqsRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    });

    eventBridgeToSqsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage'],
      resources: [stripeEventQueue.queueArn],
    }));

    //
    // EventBridge Rules
    //

    // Stripe Partner EventBus → ProcessingEventBus に転送
    new events.CfnRule(this, 'StripePartnerToProcessingBusRule', {
      name: 'StripePartnerToProcessingBusRule',
      eventBusName: stripePartnerEventBus.eventBusName,
      eventPattern: {
        source: [{ prefix: 'aws.partner/stripe.com' }],
      },
      targets: [{
        arn: processingEventBus.eventBusArn,
        id: 'ForwardToProcessingBus',
        roleArn: eventBridgeToProcessingBusRole.roleArn,
      }],
    });

    // InternalEventBus → ProcessingEventBus に転送
    new events.Rule(this, 'InternalToProcessingBusRule', {
      eventBus: internalEventBus,
      eventPattern: {
        source: ['custom.stripe.test'],
      },
      targets: [new targets.EventBus(processingEventBus)],
    });

    // ProcessingEventBus → SQS に転送（カスタムイベント用）
    new events.Rule(this, 'ProcessingBusToSqsCustomRule', {
      eventBus: processingEventBus,
      eventPattern: {
        source: ['custom.stripe.test'],
      },
      targets: [new targets.SqsQueue(stripeEventQueue)],
    });

    // ProcessingEventBus → SQS に転送（Stripeイベント用）
    new events.CfnRule(this, 'ProcessingBusToSqsStripeRule', {
      name: 'ProcessingBusToSqsStripeRule',
      eventBusName: processingEventBus.eventBusName,
      eventPattern: {
        source: [{ prefix: 'aws.partner/stripe.com' }],
      },
      targets: [{
        arn: stripeEventQueue.queueArn,
        id: 'ForwardToStripeQueue',
        roleArn: eventBridgeToSqsRole.roleArn,
      }],
    });

    //
    // SQS → Lambda 紐付け
    //

    stripeEventProcessorFunction.addEventSource(
      new event_sources.SqsEventSource(stripeEventQueue)
    );
  }
}
