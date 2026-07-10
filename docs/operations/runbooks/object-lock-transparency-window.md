# Object Lock Transparency Evidence Window

This runbook describes a bounded future AWS evidence collection. It does not authorize AWS mutations and is not evidence that Object Lock is deployed.

## Approval and preflight

1. Obtain approval for the exact account, region, stack, bucket name, retention duration, cost bound, and cleanup constraints.
2. Confirm that creating an Object Lock-enabled bucket and retained object versions is acceptable: retention may intentionally prevent immediate deletion and can outlive the test window.
3. Record existing resources and choose collision-free dev identifiers. Do not change production retention, IAM trust, KMS policy, or tenant derivation.
4. Prepare the sanitizer and the live-evidence bundle validator before deployment.

## Evidence capture

1. Deploy only the approved dev resources and record template/commit digests.
2. Confirm versioning and Object Lock configuration with read-only inspection.
3. Upload one synthetic checkpoint bundle that contains no tenant content or secrets.
4. Record its object key, version ID, checksum, retention mode, retain-until timestamp, and caller role fingerprint.
5. Attempt bounded overwrite and delete operations against that exact retained version. Capture sanitized denial codes and request timestamps; do not broaden the test to unrelated objects.
6. Download the retained object and run the local inclusion/checkpoint/witness verifier commands.
7. Validate and sanitize the evidence bundle before it leaves the dev evidence location.

## Cleanup and closeout

1. Remove only resources that are legally and technically deletable under the approved retention settings.
2. Record retained versions that prevent stack or bucket deletion, their expiry time, expected storage cost, and named cleanup owner.
3. Confirm the state of every created resource; a failed destroy is an open cleanup item, not a successful lifecycle.
4. Link the sanitized bundle, verifier report, and cleanup report to the commit and runbook version.

## Required denial evidence

The bundle is incomplete unless it records both an overwrite/versioning test and a delete/retention test, including operation, expected denial, observed result, timestamp, object version, and sanitized principal context. A configuration dump alone cannot support an overwrite/delete-denial statement.

Object Lock behavior is live AWS behavior. Local tests and CDK synthesis cannot close this evidence requirement.
