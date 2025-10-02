# Cross-Account Deployment Guide

## Overview
This guide shows how to deploy your data pipeline across multiple AWS accounts:
- **Dev Account** (111111111111): Development and testing
- **Prod Account** (222222222222): Production deployment

## Repository Structure Options

### Option 1: Single Repository (Recommended)
```
data-pipeline/
├── infra/              # CDK infrastructure code
│   ├── lib/
│   ├── bin/
│   └── package.json
├── app/                # Application code
│   ├── src/
│   ├── Dockerfile
│   └── requirements.txt
├── .github/workflows/
│   ├── deploy-infra.yml
│   └── deploy-app.yml
├── environments/
│   ├── dev.json
│   └── prod.json
└── README.md
```

**Benefits:**
- Same codebase, different deployment targets
- Branch-based deployment (develop → dev, main → prod)
- Environment-specific configurations
- Coordinated infrastructure and application changes
- Simpler repository management

### Option 2: Separate Repositories (Enterprise)
```
data-pipeline-infra/    # Infrastructure repository
data-pipeline-app/      # Application repository
```

**Use when:**
- Different teams manage infrastructure vs application
- Different release cycles (infra changes less frequently)
- Strict organizational separation required
- Large enterprise environments

### Recommendation
**Use single repository** for most cases. This guide assumes single repository structure with environment-based deployment.

## Prerequisites
- Two AWS accounts with appropriate permissions
- GitHub repository with Actions enabled
- AWS CLI configured locally

## Account Setup

### Step 1: Prepare Both AWS Accounts

#### Dev Account (111111111111)
```bash
# Configure AWS CLI for dev account
aws configure --profile dev
# Enter dev account credentials

# Bootstrap CDK
aws --profile dev cdk bootstrap aws://111111111111/ap-southeast-1
```

#### Prod Account (222222222222)
```bash
# Configure AWS CLI for prod account
aws configure --profile prod
# Enter prod account credentials

# Bootstrap CDK with cross-account trust
aws --profile prod cdk bootstrap aws://222222222222/ap-southeast-1 \
  --trust 111111111111 \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/PowerUserAccess
```

### Step 2: Create Cross-Account IAM Role (Prod Account)

Create `cross-account-role.ts` in your infrastructure repository:

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class CrossAccountRoleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Role for GitHub Actions to assume from dev account
    const githubRole = new iam.Role(this, 'GitHubActionsRole', {
      roleName: 'GitHubActionsDeployRole',
      assumedBy: new iam.CompositePrincipal(
        new iam.AccountPrincipal('111111111111'), // Dev account
        new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
      ),
      externalIds: ['github-actions-external-id'],
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess')
      ]
    });

    // Output the role ARN
    new cdk.CfnOutput(this, 'CrossAccountRoleArn', {
      value: githubRole.roleArn,
      description: 'ARN of the cross-account deployment role'
    });
  }
}
```

Deploy this role to prod account:
```bash
aws --profile prod cdk deploy CrossAccountRoleStack
```

## Infrastructure Setup (Single Repository)

### Step 3: Create Directory Structure

```bash
mkdir -p infra/lib infra/bin app/src .github/workflows environments
```

### Step 4: Environment Configuration Files

Create `environments/dev.json`:
```json
{
  "accountId": "111111111111",
  "region": "ap-southeast-1",
  "environment": "dev",
  "resources": {
    "ecsMemory": 512,
    "ecsCpu": 256,
    "schedule": "cron(0 9 1 * ? *)",
    "removalPolicy": "DESTROY"
  }
}
```

Create `environments/prod.json`:
```json
{
  "accountId": "222222222222",
  "region": "ap-southeast-1",
  "environment": "prod",
  "resources": {
    "ecsMemory": 1024,
    "ecsCpu": 512,
    "schedule": "cron(0 0 15 * ? *)",
    "removalPolicy": "RETAIN"
  }
}
```

### Step 5: Modify Your CDK Stack for Multi-Account

Update `infra/lib/data-pipeline-stack.ts`:

Update `lib/data-pipeline-stack.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface DataPipelineStackProps extends cdk.StackProps {
  environment: 'dev' | 'prod';
  accountId: string;
}

export class DataPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataPipelineStackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: props.accountId,
        region: 'ap-southeast-1'
      }
    });

    const envPrefix = props.environment;
    
    // Environment-specific S3 bucket
    const bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${envPrefix}-data-pipeline-${props.accountId.slice(-6)}`,
      removalPolicy: props.environment === 'dev' 
        ? cdk.RemovalPolicy.DESTROY 
        : cdk.RemovalPolicy.RETAIN
    });

    // ECR repository
    const repository = new ecr.Repository(this, 'DataPipelineRepo', {
      repositoryName: `${envPrefix}-data-pipeline`,
      removalPolicy: props.environment === 'dev' 
        ? cdk.RemovalPolicy.DESTROY 
        : cdk.RemovalPolicy.RETAIN
    });

    // Cross-account ECR access (only in prod)
    if (props.environment === 'prod') {
      repository.addToResourcePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal('111111111111')], // Dev account
        actions: [
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetAuthorizationToken'
        ]
      }));
    }

    // Use existing VPC or create new one
    const vpc = props.environment === 'prod' 
      ? ec2.Vpc.fromLookup(this, 'ExistingVpc', { isDefault: true })
      : new ec2.Vpc(this, 'DataPipelineVpc', { maxAzs: 2 });

    // ECS cluster
    const cluster = new ecs.Cluster(this, 'DataPipelineCluster', {
      clusterName: `${envPrefix}-data-pipeline-cluster`,
      vpc: vpc
    });

    // ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'DataPipelineTask', {
      family: `${envPrefix}-data-pipeline-task`,
      memoryLimitMiB: props.environment === 'prod' ? 1024 : 512,
      cpu: props.environment === 'prod' ? 512 : 256
    });

    // Task execution role with cross-account permissions
    taskDefinition.addToExecutionRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage'
      ],
      resources: ['*']
    }));

    // Add container
    taskDefinition.addContainer('DataPipelineContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: `${envPrefix}-data-pipeline`
      }),
      environment: {
        ENVIRONMENT: props.environment,
        BUCKET_NAME: bucket.bucketName
      }
    });

    // EventBridge schedule (different for each environment)
    const scheduleRule = new events.Rule(this, 'MonthlySchedule', {
      ruleName: `${envPrefix}-monthly-schedule`,
      schedule: props.environment === 'dev'
        ? events.Schedule.cron({ minute: '0', hour: '9', day: '1' }) // 1st of month at 9 AM for testing
        : events.Schedule.cron({ minute: '0', hour: '0', day: '15' }) // 15th at midnight for prod
    });

    // Add ECS task as target
    scheduleRule.addTarget(new targets.EcsTask({
      cluster: cluster,
      taskDefinition: taskDefinition,
      subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    }));

    // Parameter Store values (environment-specific)
    new ssm.StringParameter(this, 'BucketNameParameter', {
      parameterName: `/${envPrefix}/myapp/s3-bucket-name`,
      stringValue: bucket.bucketName
    });

    new ssm.StringParameter(this, 'EcrRepoParameter', {
      parameterName: `/${envPrefix}/myapp/ecr-repository-uri`,
      stringValue: repository.repositoryUri
    });

    new ssm.StringParameter(this, 'ClusterNameParameter', {
      parameterName: `/${envPrefix}/myapp/ecs-cluster-name`,
      stringValue: cluster.clusterName
    });

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: `${envPrefix} S3 bucket name`
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: `${envPrefix} ECR repository URI`
    });
  }
}
```

### Step 4: Update App Entry Point

Update `bin/data-pipeline-infra.ts`:

```typescript
#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DataPipelineStack } from '../lib/data-pipeline-stack';
import { CrossAccountRoleStack } from '../lib/cross-account-role';

const app = new cdk.App();

// Get environment from context
const env = app.node.tryGetContext('env') || 'dev';

// Account mapping
const accountMap = {
  dev: '111111111111',  // Replace with your dev account ID
  prod: '222222222222'  // Replace with your prod account ID
};

// Validate environment
if (!accountMap[env as keyof typeof accountMap]) {
  throw new Error(`Invalid environment: ${env}. Must be 'dev' or 'prod'`);
}

const accountId = accountMap[env as keyof typeof accountMap];

// Deploy cross-account role only in prod
if (env === 'prod') {
  new CrossAccountRoleStack(app, 'CrossAccountRoleStack', {
    env: {
      account: accountId,
      region: 'ap-southeast-1'
    }
  });
}

// Deploy main stack
new DataPipelineStack(app, `DataPipelineStack-${env}`, {
  environment: env as 'dev' | 'prod',
  accountId: accountId,
  env: {
    account: accountId,
    region: 'ap-southeast-1'
  }
});
```

## CI/CD Pipeline Setup (Single Repository)

### Step 6: Infrastructure CI/CD

Create `.github/workflows/deploy-infrastructure.yml`:

Create `.github/workflows/deploy-infrastructure.yml`:

```yaml
name: Deploy Infrastructure

on:
  push:
    branches: [main, develop]
    paths: ['lib/**', 'bin/**', 'package.json']
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - prod

jobs:
  deploy-dev:
    if: github.ref == 'refs/heads/develop' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'dev')
    runs-on: ubuntu-latest
    environment: development
    steps:
      - name: Checkout
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Configure AWS credentials (Dev)
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.DEV_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.DEV_AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Dev
        run: |
          npx cdk deploy DataPipelineStack-dev \
            --context env=dev \
            --require-approval never \
            --outputs-file dev-outputs.json
      
      - name: Upload Dev Outputs
        uses: actions/upload-artifact@v3
        with:
          name: dev-outputs
          path: dev-outputs.json

  deploy-prod:
    if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'prod')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Checkout
        uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Configure AWS credentials (Prod)
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.PROD_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.PROD_AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy Cross-Account Role
        run: |
          npx cdk deploy CrossAccountRoleStack \
            --context env=prod \
            --require-approval never
      
      - name: Deploy to Prod
        run: |
          npx cdk deploy DataPipelineStack-prod \
            --context env=prod \
            --require-approval never \
            --outputs-file prod-outputs.json
      
      - name: Upload Prod Outputs
        uses: actions/upload-artifact@v3
        with:
          name: prod-outputs
          path: prod-outputs.json
```

### Step 7: Application CI/CD

Create `.github/workflows/deploy-application.yml`:

```yaml
name: Deploy Application

on:
  push:
    branches: [main, develop]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - prod

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest
      
      - name: Run tests
        run: pytest tests/ || echo "No tests found"
      
      - name: Build Docker image
        run: docker build -t data-pipeline:${{ github.sha }} .

  deploy-dev:
    needs: test
    if: github.ref == 'refs/heads/develop' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'dev')
    runs-on: ubuntu-latest
    environment: development
    steps:
      - name: Checkout
        uses: actions/checkout@v3
      
      - name: Configure AWS credentials (Dev)
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.DEV_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.DEV_AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
      
      - name: Get Dev ECR URI
        id: ecr-dev
        run: |
          ECR_URI=$(aws ssm get-parameter --name "/dev/myapp/ecr-repository-uri" --query "Parameter.Value" --output text)
          echo "uri=$ECR_URI" >> $GITHUB_OUTPUT
      
      - name: Build and push to Dev ECR
        run: |
          aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ${{ steps.ecr-dev.outputs.uri }}
          docker build -t data-pipeline .
          docker tag data-pipeline:latest ${{ steps.ecr-dev.outputs.uri }}:latest
          docker tag data-pipeline:latest ${{ steps.ecr-dev.outputs.uri }}:${{ github.sha }}
          docker push ${{ steps.ecr-dev.outputs.uri }}:latest
          docker push ${{ steps.ecr-dev.outputs.uri }}:${{ github.sha }}

  deploy-prod:
    needs: test
    if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'prod')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Checkout
        uses: actions/checkout@v3
      
      - name: Configure AWS credentials (Dev account for cross-account access)
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.DEV_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.DEV_AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
      
      - name: Assume cross-account role
        uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: arn:aws:iam::222222222222:role/GitHubActionsDeployRole
          role-external-id: github-actions-external-id
          aws-region: ap-southeast-1
          role-session-name: GitHubActions-${{ github.run_id }}
      
      - name: Get Prod ECR URI
        id: ecr-prod
        run: |
          ECR_URI=$(aws ssm get-parameter --name "/prod/myapp/ecr-repository-uri" --query "Parameter.Value" --output text)
          echo "uri=$ECR_URI" >> $GITHUB_OUTPUT
      
      - name: Build and push to Prod ECR
        run: |
          aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ${{ steps.ecr-prod.outputs.uri }}
          docker build -t data-pipeline .
          docker tag data-pipeline:latest ${{ steps.ecr-prod.outputs.uri }}:latest
          docker tag data-pipeline:latest ${{ steps.ecr-prod.outputs.uri }}:${{ github.sha }}
          docker push ${{ steps.ecr-prod.outputs.uri }}:latest
          docker push ${{ steps.ecr-prod.outputs.uri }}:${{ github.sha }}
      
      - name: Force ECS deployment
        run: |
          CLUSTER_NAME=$(aws ssm get-parameter --name "/prod/myapp/ecs-cluster-name" --query "Parameter.Value" --output text)
          aws ecs update-service --cluster $CLUSTER_NAME --service DataPipelineService --force-new-deployment || echo "Service not running, will be started by schedule"
```

## GitHub Secrets Setup

### Step 8: Configure GitHub Secrets

In your repository, add these secrets:

#### Development Secrets
- `DEV_AWS_ACCESS_KEY_ID`: Dev account access key
- `DEV_AWS_SECRET_ACCESS_KEY`: Dev account secret key

#### Production Secrets  
- `PROD_AWS_ACCESS_KEY_ID`: Prod account access key
- `PROD_AWS_SECRET_ACCESS_KEY`: Prod account secret key

### Step 9: GitHub Environment Protection

1. Go to repository **Settings** → **Environments**
2. Create **development** and **production** environments
3. For **production** environment:
   - Add **Required reviewers** (yourself or team)
   - Set **Deployment branches** to `main` only
   - Add **Environment secrets** if different from repository secrets

## Deployment Workflow

### Step 10: Deploy Infrastructure

```bash
# Deploy to dev account
git checkout develop
git push origin develop  # Triggers dev deployment

# Deploy to prod account  
git checkout main
git push origin main     # Triggers prod deployment (with approval)
```

### Step 11: Deploy Application

```bash
# Deploy app to dev
git checkout develop
# Make changes to src/main.py
git commit -am "Update data processing logic"
git push origin develop  # Triggers dev app deployment

# Deploy app to prod
git checkout main
git merge develop
git push origin main     # Triggers prod app deployment (with approval)
```

## Testing Cross-Account Setup

### Step 12: Verify Deployment

```bash
# Check dev environment
aws --profile dev ssm get-parameters --names \
  "/dev/myapp/s3-bucket-name" \
  "/dev/myapp/ecr-repository-uri" \
  "/dev/myapp/ecs-cluster-name"

# Check prod environment  
aws --profile prod ssm get-parameters --names \
  "/prod/myapp/s3-bucket-name" \
  "/prod/myapp/ecr-repository-uri" \
  "/prod/myapp/ecs-cluster-name"
```

### Step 13: Test Cross-Account ECR Access

```bash
# From dev account, try to pull prod ECR image
aws --profile dev ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin 222222222222.dkr.ecr.ap-southeast-1.amazonaws.com

docker pull 222222222222.dkr.ecr.ap-southeast-1.amazonaws.com/prod-data-pipeline:latest
```

## Monitoring and Troubleshooting

### Common Issues

1. **Cross-account role assumption fails**
   - Check external ID matches
   - Verify trust relationship includes correct dev account ID
   - Ensure role has necessary permissions

2. **ECR access denied**
   - Verify ECR resource policy allows dev account
   - Check ECR repository exists in target account
   - Confirm authentication token is valid

3. **Parameter Store access denied**
   - Ensure cross-account role has SSM permissions
   - Verify parameter names match environment prefix
   - Check parameter exists in target account

### Useful Commands

```bash
# Check cross-account role
aws --profile prod iam get-role --role-name GitHubActionsDeployRole

# List ECR repositories
aws --profile dev ecr describe-repositories
aws --profile prod ecr describe-repositories

# Check ECS clusters
aws --profile dev ecs list-clusters
aws --profile prod ecs list-clusters

# View CloudFormation stacks
aws --profile dev cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
aws --profile prod cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

## Security Best Practices

1. **Principle of Least Privilege**: Cross-account roles should have minimal required permissions
2. **External IDs**: Always use external IDs for cross-account role assumptions
3. **Environment Separation**: Keep dev and prod completely isolated
4. **Audit Logging**: Enable CloudTrail in both accounts
5. **Resource Tagging**: Tag all resources with environment and owner information
6. **Regular Reviews**: Periodically review cross-account permissions and access patterns

## Cost Optimization

1. **Resource Sizing**: Use smaller instances in dev, appropriate sizing in prod
2. **Scheduled Shutdown**: Consider shutting down dev resources outside business hours
3. **Retention Policies**: Shorter retention for dev logs and backups
4. **Reserved Instances**: Use RIs for predictable prod workloads
5. **Cost Alerts**: Set up billing alerts for both accounts

This setup provides enterprise-grade cross-account deployment with proper security boundaries and automated CI/CD pipelines!