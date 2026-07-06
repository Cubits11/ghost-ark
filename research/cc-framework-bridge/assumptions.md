# Assumptions

- Private Ghost Protocol repositories are not assumed to be available.
- Workshop labs are treated as operational reference patterns, not product code.
- AWS KMS asymmetric signing is the receipt root of trust.
- Lake Formation is the primary fine-grained analytical governance mechanism.
- DynamoDB ledger tables are append-oriented and conditionally written.
- Multi-account federation is designed into interfaces but not required for the first deployment.
