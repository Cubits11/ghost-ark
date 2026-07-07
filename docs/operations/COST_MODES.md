Ghost Ark Cost Modes
====================

Purpose
-------

Ghost Ark must be usable as a bounded AWS development system without accidentally deploying expensive search infrastructure.

This document defines the cost boundary between Core Mode and Search Mode.

The goal is not to claim that Ghost Ark is free.
The goal is to make cost-sensitive deployment behavior explicit, reviewable, and testable.

Core Mode
---------

Core Mode is the default Ghost Ark deployment mode.

Core Mode is intended for:

- development smoke tests
- receipt issuance
- receipt retrieval
- tenant-scoped API validation
- KMS signing
- DynamoDB persistence
- S3 evidence lake storage
- CloudWatch observability
- bounded assurance demos

Core Mode includes:

- Amazon Cognito
- Amazon API Gateway
- AWS Lambda
- AWS KMS
- Amazon DynamoDB
- Amazon S3
- AWS Glue Catalog
- AWS Lake Formation tags and governance configuration
- Amazon Athena workgroup
- AWS Step Functions orchestration
- Amazon CloudWatch
- Amazon SNS

Core Mode intentionally excludes by default:

- Amazon OpenSearch Service
- OpenSearch VPC
- NAT Gateway
- Elastic IP
- search Lambda VPC attachment
- /search API route

Core Mode deployment behavior
-----------------------------

By default, Ghost Ark should synthesize and deploy:

- GhostArk-dev-Api
- GhostArk-dev-Orchestration
- GhostArk-dev-Observatory

By default, Ghost Ark should not synthesize or deploy:

- GhostArk-dev-Search
- AWS::OpenSearchService::Domain
- AWS::EC2::NatGateway
- AWS::EC2::EIP caused by search infrastructure

Search Mode
-----------

Search Mode is optional.

Search Mode is intended for:

- evidence indexing
- tenant-filtered evidence search
- OpenSearch-backed retrieval
- later search-plane validation

Search Mode may introduce materially higher cost because it can require:

- Amazon OpenSearch Service
- VPC networking
- NAT Gateway
- Elastic IP
- additional Lambda networking configuration

Search Mode must be enabled explicitly.

Search Mode enablement
----------------------

Search Mode may be enabled through CDK context or environment variable.

Examples:

GHOST_ARK_ENABLE_SEARCH=true npx cdk deploy GhostArk-dev-Search GhostArk-dev-Api

or:

npx cdk deploy GhostArk-dev-Search GhostArk-dev-Api -c enableSearch=true

Search Mode should not be enabled casually in a personal AWS account.

Search Mode validation requirements
-----------------------------------

Search Mode is not considered validated merely because Core Mode passes.

Search Mode requires separate validation evidence, including:

- OpenSearch domain deployment status
- VPC and security group review
- NAT Gateway cost acknowledgment
- /search API route authorization test
- tenant-filtered search behavior test
- evidence indexing test
- search failure-mode test
- teardown instructions

Core Mode validated behavior
----------------------------

The known dev-core baseline validates:

- Cognito-authenticated API access
- tenant identity propagation through custom:tenant_slug
- POST /receipts returning HTTP 201
- KMS receipt signing
- DynamoDB receipt persistence
- tenant-scoped receipt retrieval
- unauthenticated /claims returning HTTP 401
- authenticated /claims returning HTTP 200
- search-disabled CDK synthesis excluding the /search route

Related commits:

- d2dc256 feat: support search-optional API deployment
- 0034884 docs: record AWS dev core smoke validation
- 2dbe551 docs: define Ghost Ark claim boundaries
- b0e181e docs: add core receipt demo runbook
- 0db62ec test: assert protected API routes require Cognito authorizer

Cost non-claims
---------------

This document does not prove:

- the deployment is free
- the deployment is always within free tier
- the deployment has no cost risk
- all AWS costs are bounded
- all resources are optimized
- search mode is safe to leave running
- production cost posture is understood

Required operator behavior
--------------------------

Before deploying, an operator should check:

- current AWS region
- current AWS account identity
- whether Search Mode is enabled
- whether OpenSearch resources will be synthesized
- whether NAT Gateway resources will be synthesized
- whether AWS Budgets alerts are configured
- whether the deployment is dev, test, or prod
- whether teardown instructions are understood

Recommended pre-deploy commands
-------------------------------

Check identity:

aws sts get-caller-identity --output table --no-cli-pager

List CDK stacks with search disabled:

GHOST_ARK_ENABLE_SEARCH=false npx cdk list

Synthesize with search disabled and inspect for expensive resources:

GHOST_ARK_ENABLE_SEARCH=false npx cdk synth GhostArk-dev-Api > /tmp/ghost-ark-api-core.yaml

grep -E "AWS::OpenSearchService::Domain|AWS::EC2::NatGateway|AWS::EC2::EIP" /tmp/ghost-ark-api-core.yaml || true

Expected result:

No OpenSearch domain.
No NAT Gateway.
No Elastic IP caused by search infrastructure.

Recommended post-deploy commands
--------------------------------

Check API stack:

aws cloudformation describe-stacks \
  --stack-name GhostArk-dev-Api \
  --query 'Stacks[0].{StackName:StackName,Status:StackStatus,Updated:LastUpdatedTime}' \
  --output table \
  --no-cli-pager

Check Search stack absence in Core Mode:

aws cloudformation describe-stacks \
  --stack-name GhostArk-dev-Search \
  --output table \
  --no-cli-pager

Expected result in Core Mode:

The Search stack should not exist unless it was explicitly deployed.

Teardown discipline
-------------------

Core Mode resources may still cost money.

Search Mode resources can cost more and should have explicit teardown instructions.

Before enabling Search Mode, create a teardown plan that includes:

- OpenSearch domain
- VPC
- NAT Gateway
- Elastic IP
- search Lambda networking
- CloudWatch logs
- residual S3 and DynamoDB data decisions

Design rule
-----------

Every future Ghost Ark service must declare which cost mode it belongs to:

- Core Mode
- Search Mode
- Batch Mode
- Experimental Mode
- Production Mode

No expensive infrastructure should become part of Core Mode without explicit documentation, tests, and cost justification.

Portfolio sentence
------------------

Ghost Ark was designed with an explicit low-cost AWS Core Mode by making OpenSearch, VPC search networking, NAT Gateway, Elastic IP, and the /search route opt-in rather than default.
