#!/usr/bin/env node

import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { StripeCdkPracticeStack } from '../lib/stripe-cdk-practice-stack';

const app = new cdk.App();

const stripePartnerEventBusArn = process.env.STRIPE_PARTNER_EVENT_BUS_ARN;
if (!stripePartnerEventBusArn) {
  throw new Error('Environment variable STRIPE_PARTNER_EVENT_BUS_ARN is not set.');
}

new StripeCdkPracticeStack(app, 'StripeCdkPracticeStack', {
  stripePartnerEventBusArn
});
