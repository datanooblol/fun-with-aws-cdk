#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { FunWithAwsCdkStack } from '../lib/fun-with-aws-cdk-stack';
import * as fs from 'fs';
import * as path from 'path';

const app = new cdk.App();

// Get environment from context
const env = app.node.tryGetContext('env') || 'dev';

// Validate environment
if (!['dev', 'prod'].includes(env)) {
  throw new Error(`Invalid environment: ${env}. Must be 'dev' or 'prod'`);
}

// Load environment config
const configPath = path.join(__dirname, '..', 'environments', `${env}.json`);
if (!fs.existsSync(configPath)) {
  throw new Error(`Configuration file not found: ${configPath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Deploy main stack
new FunWithAwsCdkStack(app, `FunWithAwsCdkStack-${env}`, {
  environment: env as 'dev' | 'prod',
  accountId: config.accountId,
  config: config,
  env: {
    account: config.accountId,
    region: config.region
  }
});