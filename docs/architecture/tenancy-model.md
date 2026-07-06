# Tenancy Model

Every tenant has a canonical slug. The slug is used in S3 prefixes, DynamoDB partition keys, Glue database names, Lake Formation tag values, Athena workgroups, and IAM policy conditions.

## Slug Contract

- Lowercase ASCII.
- Starts with a letter.
- Contains letters, digits, and single hyphens.
- Maximum length is 48 characters.

## Namespace Shape

- Raw S3: `s3://<raw-bucket>/tenants/<slug>/raw/`
- Curated S3: `s3://<curated-bucket>/tenants/<slug>/curated/`
- Exports: `s3://<export-bucket>/tenants/<slug>/evidence-packs/`
- Glue database: `ghost_ark_<stage>_<slug>`
- DynamoDB partition key: `<slug>`
- LF-Tag: `tenant_slug=<slug>`

## Boundary Controls

IAM policies use `${aws:PrincipalTag/slug}` for resource scoping and reject requests outside approved regions. System roles are not tenant-editable. Tenants can pass only centrally created service roles to the intended AWS service.
