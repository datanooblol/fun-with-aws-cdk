# Data Pipeline Project Guide

## Overview
This guide shows how to set up a data pipeline with **two separate repositories**:
1. **Infrastructure Repository** (CDK) - AWS resources
2. **Application Repository** (Docker) - Data processing code

## Repository Structure

### Repository 1: Infrastructure (`data-pipeline-infra`)
```
data-pipeline-infra/
├── bin/
│   └── data-pipeline-infra.ts
├── lib/
│   └── data-pipeline-stack.ts
├── package.json
├── cdk.json
└── README.md
```

### Repository 2: Application (`data-pipeline-app`)
```
data-pipeline-app/
├── src/
│   └── main.py
├── Dockerfile
├── requirements.txt
├── .github/workflows/
│   └── deploy.yml
└── README.md
```

## Step-by-Step Setup

### Phase 1: Infrastructure Repository Setup

#### 1. Create Infrastructure Repository
```bash
mkdir data-pipeline-infra
cd data-pipeline-infra
git init
cdk init app --language typescript
```

#### 2. Deploy Infrastructure
```bash
npm install
npm run build
cdk bootstrap
cdk deploy
```

#### 3. Get Infrastructure Outputs
```bash
# Get ECR repository URI
aws ssm get-parameter --name "/myapp/ecr-repository-uri" --query "Parameter.Value" --output text

# Get S3 bucket name
aws ssm get-parameter --name "/myapp/s3-bucket-name" --query "Parameter.Value" --output text
```

### Phase 2: Application Repository Setup

#### 1. Create Application Repository
```bash
mkdir data-pipeline-app
cd data-pipeline-app
git init
```

#### 2. Create Application Files

**src/main.py:**
```python
import boto3
import os
from datetime import datetime

def main():
    print(f"Data pipeline started at {datetime.now()}")
    
    # Get bucket name from environment or Parameter Store
    s3_client = boto3.client('s3')
    ssm_client = boto3.client('ssm')
    
    bucket_name = ssm_client.get_parameter(
        Name='/myapp/s3-bucket-name'
    )['Parameter']['Value']
    
    # Your data processing logic here
    print(f"Processing data to bucket: {bucket_name}")
    
    print("Data pipeline completed successfully")

if __name__ == "__main__":
    main()
```

**Dockerfile:**
```dockerfile
FROM python:3.9-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/ ./src/
CMD ["python", "src/main.py"]
```

**requirements.txt:**
```
boto3==1.34.0
```

#### 3. Build and Push Docker Image
```bash
# Get ECR login
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com

# Build image
docker build -t data-pipeline .

# Tag for ECR
docker tag data-pipeline:latest <ecr-uri>:latest

# Push to ECR
docker push <ecr-uri>:latest
```

### Phase 3: CI/CD Setup

#### Application Repository CI/CD (`.github/workflows/deploy.yml`)
```yaml
name: Deploy Data Pipeline

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-southeast-1
      
      - name: Get ECR URI
        id: ecr
        run: |
          ECR_URI=$(aws ssm get-parameter --name "/myapp/ecr-repository-uri" --query "Parameter.Value" --output text)
          echo "uri=$ECR_URI" >> $GITHUB_OUTPUT
      
      - name: Build and push Docker image
        run: |
          aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin ${{ steps.ecr.outputs.uri }}
          docker build -t data-pipeline .
          docker tag data-pipeline:latest ${{ steps.ecr.outputs.uri }}:latest
          docker push ${{ steps.ecr.outputs.uri }}:latest
      
      - name: Force ECS deployment
        run: |
          aws ecs update-service --cluster DataPipelineCluster --service DataPipelineService --force-new-deployment
```

## Development Workflow

### Daily Development (Application Changes)
1. **Modify** `src/main.py` with your data processing logic
2. **Commit and push** to application repository
3. **CI/CD automatically** builds and deploys new container
4. **Test** by running ECS task manually or wait for scheduled run

### Infrastructure Changes (Rare)
1. **Modify** CDK stack in infrastructure repository
2. **Deploy** with `cdk deploy`
3. **Update** application repository if new resources are added

## Testing

### Manual Testing
```bash
# Run ECS task manually
aws ecs run-task \
  --cluster DataPipelineCluster \
  --task-definition DataPipelineTask \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

### Local Testing
```bash
# Test Docker container locally
docker run --rm \
  -e AWS_ACCESS_KEY_ID=your-key \
  -e AWS_SECRET_ACCESS_KEY=your-secret \
  -e AWS_DEFAULT_REGION=ap-southeast-1 \
  data-pipeline
```

## Environment Management

### Multiple Environments
Deploy infrastructure to different environments:

```bash
# Development
cdk deploy --context env=dev

# Production  
cdk deploy --context env=prod
```

Update Parameter Store paths:
- Dev: `/dev/myapp/s3-bucket-name`
- Prod: `/prod/myapp/s3-bucket-name`

## Monitoring

### Check Logs
```bash
# View ECS task logs
aws logs describe-log-groups --log-group-name-prefix "/aws/ecs/data-pipeline"
aws logs get-log-events --log-group-name "/aws/ecs/data-pipeline" --log-stream-name "ecs/DataPipelineContainer/task-id"
```

### Check Schedule
```bash
# View EventBridge rule
aws events describe-rule --name MonthlySchedule
```

## Troubleshooting

### Common Issues
1. **Image not found**: Ensure Docker image is pushed to ECR with `:latest` tag
2. **Task fails to start**: Check ECS task definition has correct ECR URI
3. **Permission denied**: Verify ECS task role has permissions for S3/SSM
4. **Schedule not working**: Check EventBridge rule is enabled and has correct cron expression

### Useful Commands
```bash
# Check ECS service status
aws ecs describe-services --cluster DataPipelineCluster --services DataPipelineService

# List ECR images
aws ecr list-images --repository-name data-pipeline

# Check Parameter Store values
aws ssm get-parameters --names "/myapp/s3-bucket-name" "/myapp/ecr-repository-uri"
```

## Next Steps
1. Add error handling and retry logic to your application
2. Implement proper logging with structured logs
3. Add monitoring and alerting with CloudWatch
4. Set up multiple environments (dev/staging/prod)
5. Add data validation and quality checks