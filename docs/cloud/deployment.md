# Ghost-Ark Google Cloud Deployment Guide

## Prerequisites

- Terraform >= 1.5
- GCP Project with Cloud Storage and BigQuery APIs enabled
- IAM Service Account (`ghostark-runtime@<project_id>.iam.gserviceaccount.com`)

## Infrastructure Provisioning

```bash
cd infra/gcp
terraform init
terraform plan -out=tfplan
# Human approval required before apply
```
