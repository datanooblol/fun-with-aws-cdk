# Environment Configuration Guide

## Overview
This project supports environment-specific configurations for conditional resource creation. The main use case is creating new resources in development while using existing resources in production.

## Configuration Files

### Development Environment (`environments/dev.json`)
```json
{
  "accountId": "111111111111",
  "region": "ap-southeast-1",
  "environment": "dev",
  "s3": {
    "createBucket": true,
    "bucketName": null
  },
  "resources": {
    "ecsMemory": 512,
    "ecsCpu": 256,
    "schedule": "cron(0 9 1 * ? *)",
    "removalPolicy": "DESTROY"
  }
}
```

### Production Environment (`environments/prod.json`)
```json
{
  "accountId": "222222222222",
  "region": "ap-southeast-1",
  "environment": "prod",
  "s3": {
    "createBucket": false,
    "bucketName": "my-existing-prod-bucket-name"
  },
  "resources": {
    "ecsMemory": 1024,
    "ecsCpu": 512,
    "schedule": "cron(0 0 15 * ? *)",
    "removalPolicy": "RETAIN"
  }
}
```

## Configuration Options

### S3 Configuration
- **createBucket**: `true` to create new bucket, `false` to use existing
- **bucketName**: Required when `createBucket` is `false`, ignored when `true`

### Resource Configuration
- **ecsMemory**: Memory allocation for ECS tasks (MB)
- **ecsCpu**: CPU allocation for ECS tasks
- **schedule**: EventBridge cron expression for scheduled runs
- **removalPolicy**: `"DESTROY"` for dev, `"RETAIN"` for prod

## Deployment Commands

### Deploy to Development
```bash
npm run build
cdk deploy --context env=dev
```

### Deploy to Production
```bash
npm run build
cdk deploy --context env=prod
```

## How It Works

### Development Environment
1. **Creates new S3 bucket** with generated name
2. **Creates new VPC** for isolation
3. **Uses smaller ECS resources** for cost optimization
4. **Runs monthly on 1st at 9 AM** for testing
5. **DESTROY removal policy** for easy cleanup

### Production Environment
1. **Uses existing S3 bucket** specified in config
2. **Uses default VPC** (or specify existing VPC ID)
3. **Uses larger ECS resources** for production workloads
4. **Runs monthly on 15th at midnight** for production schedule
5. **RETAIN removal policy** for data protection
6. **Cross-account ECR access** for image pulling from dev

## Parameter Store Values

All configurations are stored in environment-specific Parameter Store paths:

### Development
- `/dev/myapp/s3-bucket-name`
- `/dev/myapp/ecr-repository-uri`
- `/dev/myapp/ecs-cluster-name`

### Production
- `/prod/myapp/s3-bucket-name`
- `/prod/myapp/ecr-repository-uri`
- `/prod/myapp/ecs-cluster-name`

## Application Code Integration

Your application code automatically uses the correct environment configuration:

```python
import os
import boto3

def main():
    # Get environment from container environment variable
    environment = os.environ.get('ENVIRONMENT', 'dev')
    
    # Get bucket name from Parameter Store
    ssm_client = boto3.client('ssm')
    bucket_name = ssm_client.get_parameter(
        Name=f'/{environment}/myapp/s3-bucket-name'
    )['Parameter']['Value']
    
    # Use bucket for data processing
    s3_client = boto3.client('s3')
    # ... your data processing logic
```

## Adding New Environments

To add a new environment (e.g., staging):

1. **Create configuration file**: `environments/staging.json`
2. **Update deployment commands**: Add staging context
3. **Configure CI/CD**: Add staging workflow

Example staging configuration:
```json
{
  "accountId": "333333333333",
  "region": "ap-southeast-1",
  "environment": "staging",
  "s3": {
    "createBucket": true,
    "bucketName": null
  },
  "resources": {
    "ecsMemory": 768,
    "ecsCpu": 384,
    "schedule": "cron(0 12 * * ? *)",
    "removalPolicy": "DESTROY"
  }
}
```

## Validation

The CDK stack includes validation to ensure:
- Valid environment names (`dev` or `prod`)
- Required bucket name when using existing bucket
- Configuration file exists for specified environment

## Best Practices

1. **Never commit real production values** to version control
2. **Use AWS Secrets Manager** for sensitive configuration
3. **Test configuration changes** in development first
4. **Document any manual setup** required for existing resources
5. **Use consistent naming conventions** across environments

## Troubleshooting

### Common Issues

1. **Configuration file not found**
   - Ensure `environments/{env}.json` exists
   - Check file path and permissions

2. **Bucket name required error**
   - Set `bucketName` when `createBucket` is `false`
   - Verify existing bucket exists and is accessible

3. **Permission denied on existing bucket**
   - Ensure ECS task role has proper permissions
   - Check bucket policy allows cross-account access if needed

4. **Invalid cron expression**
   - Use EventBridge cron format: `cron(minute hour day month ? year)`
   - Test expressions using AWS EventBridge console

### Useful Commands

```bash
# Validate configuration
cat environments/dev.json | jq .

# Check Parameter Store values
aws ssm get-parameters --names \
  "/dev/myapp/s3-bucket-name" \
  "/dev/myapp/ecr-repository-uri" \
  "/dev/myapp/ecs-cluster-name"

# List all stacks
cdk list --context env=dev
cdk list --context env=prod
```