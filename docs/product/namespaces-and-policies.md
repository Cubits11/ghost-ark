# Namespaces And Policies

Ghost Ark namespaces are deterministic. A tenant slug compiles into:

- Resource names.
- S3 prefixes.
- Glue database names.
- Lake Formation LF-Tag values.
- OpenSearch index aliases.
- DynamoDB partition keys.
- IAM policy variables and condition checks.

Generated policies must be reviewed as code. Console edits are acceptable only as break-glass operations and must be reconciled back into Terraform or CDK.
