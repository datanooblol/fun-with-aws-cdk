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
  config: {
    s3: {
      createBucket: boolean;
      bucketName?: string;
    };
    resources: {
      ecsMemory: number;
      ecsCpu: number;
      schedule: string;
      removalPolicy: string;
    };
  };
}

export class FunWithAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataPipelineStackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: props.accountId,
        region: props.config ? 'ap-southeast-1' : props.env?.region
      }
    });

    const envPrefix = props.environment;
    
    // Conditional bucket creation/lookup
    let bucket: s3.IBucket;
    
    if (props.config.s3.createBucket) {
      // Create new bucket (dev)
      bucket = new s3.Bucket(this, 'DataBucket', {
        bucketName: `${envPrefix}-data-pipeline-${props.accountId.slice(-6)}`,
        removalPolicy: props.config.resources.removalPolicy === 'DESTROY' 
          ? cdk.RemovalPolicy.DESTROY 
          : cdk.RemovalPolicy.RETAIN
      });
    } else {
      // Use existing bucket (prod)
      if (!props.config.s3.bucketName) {
        throw new Error('Bucket name required when createBucket is false');
      }
      bucket = s3.Bucket.fromBucketName(this, 'ExistingBucket', 
        props.config.s3.bucketName
      );
    }

    // Create Parameter Store parameter with bucket name
    new ssm.StringParameter(this, 'BucketNameParameter', {
      parameterName: `/${envPrefix}/myapp/s3-bucket-name`,
      stringValue: bucket.bucketName
    });

    // Create ECR repository for Docker images
    const repository = new ecr.Repository(this, 'DataPipelineRepo', {
      repositoryName: `${envPrefix}-data-pipeline`,
      removalPolicy: props.config.resources.removalPolicy === 'DESTROY' 
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

    // Use existing VPC in prod, create new in dev
    const vpc = props.environment === 'prod' 
      ? ec2.Vpc.fromLookup(this, 'ExistingVpc', { isDefault: true })
      : new ec2.Vpc(this, 'DataPipelineVpc', { maxAzs: 2 });

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'DataPipelineCluster', {
      clusterName: `${envPrefix}-data-pipeline-cluster`,
      vpc: vpc
    });

    // Create ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'DataPipelineTask', {
      family: `${envPrefix}-data-pipeline-task`,
      memoryLimitMiB: props.config.resources.ecsMemory,
      cpu: props.config.resources.ecsCpu
    });

    // Grant bucket permissions to ECS task
    bucket.grantReadWrite(taskDefinition.taskRole);

    // Add container to task
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

    // Create EventBridge rule with environment-specific schedule
    const scheduleRule = new events.Rule(this, 'MonthlySchedule', {
      ruleName: `${envPrefix}-monthly-schedule`,
      schedule: events.Schedule.expression(props.config.resources.schedule)
    });

    // // Add ECS task as target for the schedule
    // scheduleRule.addTarget(new targets.EcsTask({
    //   cluster: cluster,
    //   taskDefinition: taskDefinition,
    //   subnetSelection: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    // }));

    // Store ECR repository URI in Parameter Store
    new ssm.StringParameter(this, 'EcrRepoParameter', {
      parameterName: `/${envPrefix}/myapp/ecr-repository-uri`,
      stringValue: repository.repositoryUri
    });

    // Store ECS cluster name in Parameter Store
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
