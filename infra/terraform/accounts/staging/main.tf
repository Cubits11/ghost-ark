variable "aws_region" {
  type    = string
  default = "us-east-1"
}

module "bootstrap" {
  source = "../../bootstrap"

  stage                 = "staging"
  aws_region            = var.aws_region
  allowed_regions       = [var.aws_region]
  bootstrap_tenant_slug = "example-tenant"
}
