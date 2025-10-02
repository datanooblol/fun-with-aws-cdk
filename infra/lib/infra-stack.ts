import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Names } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// update idea
export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const bucket = new s3.Bucket(this, 'TestContainerDevelopmentBucket', {
      bucketName: `test-container-development-${Names.uniqueId(this).toLowerCase()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // ECR Repository
    const repository = new ecr.Repository(this, 'TestPreprocessingRepo', {
      repositoryName: 'test-preprocessing',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // VPC
    const vpc = new ec2.Vpc(this, 'TestVpc', {
      maxAzs: 2
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'TestCluster', {
      vpc: vpc
    });

    // ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TestPreprocessingTask', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    // Grant S3 permissions to ECS task
    bucket.grantReadWrite(taskDefinition.taskRole);
    taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess')
    );

    // Add container to task
    taskDefinition.addContainer('TestPreprocessingContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'test-preprocessing'
      })
    });

    // Step Function - ECS Run Task
    const runTask = new tasks.EcsRunTask(this, 'RunPreprocessingTask', {
      integrationPattern: stepfunctions.IntegrationPattern.RUN_JOB,
      cluster: cluster,
      taskDefinition: taskDefinition,
      launchTarget: new tasks.EcsFargateLaunchTarget(),
      containerOverrides: [{
        containerDefinition: taskDefinition.defaultContainer!,
        environment: [{
          name: 'TASK_TOKEN',
          value: stepfunctions.JsonPath.taskToken
        }]
      }]
    });

    // Success state
    const successState = new stepfunctions.Succeed(this, 'ProcessingSucceeded', {
      comment: 'Data processing completed successfully'
    });

    // Failure state
    const failureState = new stepfunctions.Fail(this, 'ProcessingFailed', {
      comment: 'Data processing failed',
      cause: 'ECS task failed to complete successfully'
    });

    // Add error handling to the ECS task
    runTask.addCatch(failureState, {
      errors: ['States.ALL']
    });

    // Step Function Definition
    const definition = stepfunctions.Chain
      .start(runTask)
      .next(successState);

    // Step Function State Machine
    const stateMachine = new stepfunctions.StateMachine(this, 'TestPreprocessingStateMachine', {
      definition: definition,
      timeout: cdk.Duration.minutes(30),
      comment: 'Data preprocessing pipeline with error handling'
    });

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'S3 Bucket for container development'
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for test-preprocessing'
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Function State Machine ARN'
    });
  }
}
