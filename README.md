# AWS CDK Data Processing Pipeline

A containerized data processing pipeline using AWS CDK, ECS, Step Functions, and S3.

## Architecture

- **S3**: Storage for input data and artifacts
- **ECR**: Container registry for Docker images
- **ECS Fargate**: Serverless container execution
- **Step Functions**: Workflow orchestration with error handling
- **Lambda**: Additional processing functions

## Project Structure

```
├── infra/              # CDK infrastructure code
├── containers/         # Docker containers
│   └── preprocessing/  # Main processing container
├── lambda/            # Lambda functions
├── dev/               # Development notebooks and utilities
└── scripts/           # Build and deployment scripts
```

## Prerequisites

- AWS CLI configured
- Docker installed
- Node.js and npm
- Python 3.12+

## Setup

### 1. Deploy Infrastructure

```bash
cd infra/
npm install
cdk bootstrap
cdk deploy
```

### 2. Build and Push Docker Image

```bash
# Build for linux/amd64 (required for ECS Fargate)
cd containers/preprocessing/
docker build --platform linux/amd64 -t test-preprocessing .

# Tag and push to ECR
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com

docker tag test-preprocessing:latest <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/test-preprocessing:latest
docker push <account-id>.dkr.ecr.ap-southeast-1.amazonaws.com/test-preprocessing:latest
```

### 3. Upload Artifacts to S3

```bash
# Upload required files
aws s3 cp pyproject.toml s3://test-container-development/artifacts/
aws s3 cp script.py s3://test-container-development/artifacts/
aws s3 cp data.csv s3://test-container-development/input/
aws s3 cp package.tar.gz s3://test-container-development/artifacts/
```

## Testing Step Functions

### Success Test

```bash
# Start execution
aws stepfunctions start-execution \
  --state-machine-arn "arn:aws:states:region:account:stateMachine:TestPreprocessingStateMachine-xxx" \
  --input '{}'

# Monitor execution
aws stepfunctions describe-execution --execution-arn "execution-arn"
```

### Failure Tests

#### 1. Application Failure
Add to `main.py`:
```python
import sys
sys.exit(1)  # Force failure
```

#### 2. Missing S3 Files
```bash
aws s3 rm s3://test-container-development/artifacts/pyproject.toml
```

#### 3. Invalid Docker Image
Update CDK with non-existent tag:
```typescript
image: ecs.ContainerImage.fromEcrRepository(repository, 'invalid-tag')
```

#### 4. Resource Limits
Set low memory in CDK:
```typescript
memoryLimitMiB: 128  // Causes OOM
```

### Check Results

- **Success**: Step Function shows "ProcessingSucceeded"
- **Failure**: Step Function shows "ProcessingFailed" with error details
- **Outputs**: Check `s3://test-container-development/output/` for results

## Development

### Local Testing

```bash
# Run with docker-compose
docker-compose up

# Test individual services
docker run -it test-preprocessing
```

### Build Scripts

```bash
# Build all Docker images
./scripts/build-docker.sh

# Deploy infrastructure
./scripts/deploy.sh
```

## Monitoring

- **CloudWatch Logs**: ECS task logs
- **Step Functions Console**: Execution history
- **S3 Console**: Input/output files
- **ECS Console**: Task status and metrics

## Troubleshooting

### Common Issues

1. **Platform mismatch**: Always build with `--platform linux/amd64`
2. **Permissions**: Ensure ECS task role has S3 access
3. **Memory limits**: Increase if seeing OOM errors
4. **File paths**: Use absolute paths in container

### Debug Commands

```bash
# Check ECS logs
aws logs describe-log-groups --log-group-name-prefix "/aws/ecs"

# List Step Function executions
aws stepfunctions list-executions --state-machine-arn "state-machine-arn"

# Check S3 objects
aws s3 ls s3://test-container-development/ --recursive
```