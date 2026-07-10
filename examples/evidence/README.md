# Evidence bundle examples

`live-aws-evidence-bundle.sample.json` is deliberately synthetic and made no AWS calls. It is an L2 schema-bound fixture for exercising the local validator and sanitizer contract. Its timestamps, hashes, stack names, and `NOT_RUN` observations are illustrative values, not preserved deployment evidence.

Validate it locally with:

```bash
npm run validate:evidence-bundle
```

A passing result establishes only that the fixture conforms to the repository's schema, semantic lifecycle rules, and leak scan. It does not establish that an AWS resource existed or that any runtime behavior occurred.

Do not copy this fixture into `evidence/live-aws-validation/` or relabel it as `live-aws-validation`. A future live bundle requires a human-authorized AWS window and must record the actual clean commit, hashed account and principal identifiers, passing observations linked to sanitized artifact digests, receipt verification where claimed, and confirmed cleanup.
