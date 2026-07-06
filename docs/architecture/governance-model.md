# Governance Model

Ghost Ark uses Lake Formation as the analytical disclosure layer. IAM scopes who can call services; Lake Formation scopes what data a principal can see once it enters the cataloged lake.

## Control Types

- Named grants for known producer and consumer roles.
- Row filters for tenant and cohort boundaries.
- Column restrictions for sensitive attributes.
- LF-Tag ABAC for classification, tenant, retention, and evidence role.
- CloudTrail review of `GetDataAccess` events.

## Required Practices

- Remove broad `IAMAllowedPrincipals` from governed tables.
- Register data locations with Lake Formation before granting analytical access.
- Prefer policy templates and generated grants over console-only configuration.
- Treat cross-account sharing as a governed federation event with explicit approval and receipt coverage.
