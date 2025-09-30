# Cross-Account Deployment Flow Chart

## Architecture Overview

```
┌─────────────────────────────────────┐    ┌─────────────────────────────────────┐
│           DEV ACCOUNT               │    │           PROD ACCOUNT              │
│         (111111111111)              │    │         (222222222222)              │
│                                     │    │                                     │
│  ┌─────────────────────────────┐    │    │  ┌─────────────────────────────┐    │
│  │        GitHub Actions       │    │    │  │        GitHub Actions       │    │
│  │                             │    │    │  │                             │    │
│  │  1. Build Docker Image      │    │    │  │  4. Assume Cross-Account    │    │
│  │  2. Push to Dev ECR         │    │    │  │     Role                    │    │
│  │  3. Test & Validate         │    │    │  │  5. Pull from Dev ECR       │    │
│  └─────────────────────────────┘    │    │  │  6. Push to Prod ECR        │    │
│                                     │    │  │  7. Deploy to Prod ECS      │    │
│  ┌─────────────────────────────┐    │    │  └─────────────────────────────┘    │
│  │         Dev ECR             │◄───┼────┼──┐                                  │
│  │                             │    │    │  │                                  │
│  │  • Build artifacts          │    │    │  │  ┌─────────────────────────────┐ │
│  │  • Docker images            │    │    │  │  │        Prod ECR             │ │
│  │  • Tagged versions          │    │    │  │  │                             │ │
│  └─────────────────────────────┘    │    │  │  │  • Production images       │ │
│                                     │    │  │  │  • Same content as Dev     │ │
│  ┌─────────────────────────────┐    │    │  │  │  • Prod-specific tags      │ │
│  │         Dev ECS             │    │    │  │  └─────────────────────────────┘ │
│  │                             │    │    │  │                                  │
│  │  • Development testing      │    │    │  │  ┌─────────────────────────────┐ │
│  │  • Integration tests        │    │    │  │  │        Prod ECS             │ │
│  │  • Validation               │    │    │  │  │                             │ │
│  └─────────────────────────────┘    │    │  │  │  • Production workloads     │ │
│                                     │    │  │  │  • Scheduled tasks          │ │
└─────────────────────────────────────┘    │  │  │  • EventBridge triggers     │ │
                                           │  │  └─────────────────────────────┘ │
                                           │  │                                  │
                                           │  └──────────────────────────────────┘
                                           │
                                           └─── Cross-Account ECR Pull
```

## Deployment Flow Steps

### Phase 1: Development & Build (Dev Account)
```
Developer Push → GitHub → GitHub Actions (Dev Account)
                              ↓
                    1. Build Docker Image
                              ↓
                    2. Push to Dev ECR
                              ↓
                    3. Deploy to Dev ECS (Testing)
                              ↓
                    4. Run Integration Tests
```

### Phase 2: Production Deployment (Cross-Account)
```
Main Branch Push → GitHub → GitHub Actions (Prod Workflow)
                              ↓
                    1. Assume Cross-Account Role
                              ↓
                    2. Pull Image from Dev ECR
                              ↓
                    3. Re-tag for Production
                              ↓
                    4. Push to Prod ECR
                              ↓
                    5. Deploy to Prod ECS
```

## Asset Building Analysis

### ❌ NO Building in Production Account
- **No Docker build** happens in prod
- **No compilation** in prod environment
- **No source code** in prod account

### ✅ Asset Flow to Production
- **Pre-built images** from dev account
- **Tested artifacts** only
- **Immutable deployments**

## Detailed Asset Flow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Source Code   │    │   Docker Build  │    │   Dev ECR       │
│                 │    │                 │    │                 │
│ • Python files  │───▶│ • Dockerfile    │───▶│ • Built image   │
│ • Dependencies  │    │ • pip install   │    │ • All layers    │
│ • Config files  │    │ • Layer caching │    │ • Tagged        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                                                       │ Cross-Account Pull
                                                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Prod ECS      │    │   Prod ECR      │    │   Image Copy    │
│                 │    │                 │    │                 │
│ • Runs image    │◄───│ • Prod copy     │◄───│ • Same content  │
│ • No building   │    │ • Prod tags     │    │ • Re-tagging    │
│ • Just execute  │    │ • Same layers   │    │ • No rebuild    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Security & Compliance Benefits

### 🔒 Immutable Deployments
```
Dev Account (Build) → Prod Account (Deploy)
     ↓                      ↓
✅ Build & Test         ✅ Deploy Only
✅ Quality Gates        ✅ No Build Tools
✅ Security Scan        ✅ Minimal Attack Surface
```

### 🛡️ Separation of Concerns
- **Dev Account**: Build tools, compilers, source code access
- **Prod Account**: Runtime only, no build dependencies
- **Audit Trail**: Clear lineage from dev to prod

## Performance Implications

### ⚡ Faster Production Deployments
```
Traditional (Build in Prod):
Source → Build (5-10 min) → Deploy → Run

Cross-Account (Pre-built):
Pre-built Image → Copy (30 sec) → Deploy → Run
```

### 💰 Cost Optimization
- **No build infrastructure** in prod
- **Smaller prod account footprint**
- **Faster deployment cycles**

## Example Commands

### Dev Account (Build Phase)
```bash
# GitHub Actions in Dev Account
docker build -t data-pipeline:${{ github.sha }} .
docker tag data-pipeline:${{ github.sha }} 111111111111.dkr.ecr.region.amazonaws.com/dev-data-pipeline:latest
docker push 111111111111.dkr.ecr.region.amazonaws.com/dev-data-pipeline:latest
```

### Prod Account (Deploy Phase)
```bash
# GitHub Actions with Cross-Account Role
# 1. Pull from Dev ECR
docker pull 111111111111.dkr.ecr.region.amazonaws.com/dev-data-pipeline:latest

# 2. Re-tag for Prod
docker tag 111111111111.dkr.ecr.region.amazonaws.com/dev-data-pipeline:latest \
           222222222222.dkr.ecr.region.amazonaws.com/prod-data-pipeline:latest

# 3. Push to Prod ECR
docker push 222222222222.dkr.ecr.region.amazonaws.com/prod-data-pipeline:latest

# 4. ECS automatically pulls from Prod ECR
```

## Alternative Approaches

### Option 1: Direct Cross-Account ECR Access (Not Recommended)
```
Prod ECS → Direct Pull from Dev ECR
```
**Issues:**
- Tight coupling between accounts
- Complex networking requirements
- Security concerns

### Option 2: Artifact Repository (Enterprise)
```
Dev → Artifact Store → Prod
```
**Use for:**
- Multiple environments
- Compliance requirements
- Large organizations

## Monitoring & Validation

### Image Integrity Checks
```bash
# Verify image SHA matches between accounts
DEV_SHA=$(docker inspect 111111111111.dkr.ecr.region.amazonaws.com/dev-data-pipeline:latest --format='{{.Id}}')
PROD_SHA=$(docker inspect 222222222222.dkr.ecr.region.amazonaws.com/prod-data-pipeline:latest --format='{{.Id}}')

if [ "$DEV_SHA" = "$PROD_SHA" ]; then
  echo "✅ Image integrity verified"
else
  echo "❌ Image mismatch detected"
fi
```

### Deployment Validation
```bash
# Check prod ECS is running the correct image
aws ecs describe-tasks --cluster prod-cluster --tasks $(aws ecs list-tasks --cluster prod-cluster --query 'taskArns[0]' --output text) \
  --query 'tasks[0].taskDefinition' --output text
```

## Summary

### ✅ What Happens in Prod Account:
- **Image copying** from dev ECR to prod ECR
- **ECS deployment** of pre-built images
- **Runtime execution** only

### ❌ What DOESN'T Happen in Prod Account:
- **No Docker builds**
- **No source code compilation**
- **No dependency installation**
- **No build tools or compilers**

This approach ensures **production security**, **faster deployments**, and **immutable artifacts** while maintaining clear separation between build and runtime environments.