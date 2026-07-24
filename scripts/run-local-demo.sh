#!/usr/bin/env bash
# Ghost-Ark local demo: the narrow, honest end-to-end story with zero AWS
# credentials, in four acts. Each act is a real command against real fixtures;
# nothing here simulates success.
#
#   Act 1 — verify a signed receipt (canonical identity, payload digest, tenant
#           expectation, RSA-PSS signature) against the pinned sample key.
#   Act 2 — prove forgeries fail: the malicious-receipt corpus must be rejected.
#   Act 3 — prove verifier independence: the standalone Node verifier must agree
#           differentially with the primary verifier.
#   Act 4 — run the governed-invoke lifecycle locally: identity from verified
#           context, pre/post-model policy gates, receipt emission, fail-closed
#           behavior.
#
# What passing means: the listed local artifacts behave as specified under the
# implemented verifier rules. It does not show live AWS behavior, deployed
# security posture, regulatory compliance, or anything about model semantics.
set -euo pipefail
cd "$(dirname "$0")/.."

banner() { printf '\n=== %s ===\n' "$1"; }

banner "Act 1/4: verify the sample receipt (expect PASS)"
npm run ghost-verify -- \
  --receipt examples/sample-receipts/valid-receipt.json \
  --key examples/sample-receipts/public-key.pem \
  --tenant acme-lab

banner "Act 2/4: malicious receipt corpus (every mutation must FAIL closed)"
npm run receipt:verify:corpus

banner "Act 3/4: independent-verifier differential agreement"
npm run receipt:verify:agreement

banner "Act 4/4: governed-invoke lifecycle (local, deterministic)"
npm test -- \
  tests/unit/enforcement-runtime/runtime \
  tests/unit/enforcement-runtime/retrieval \
  tests/unit/enforcement-runtime/receipts \
  tests/integration/test_governedInvokeLifecycle.test.ts

banner "demo complete"
echo "You verified a receipt, watched forgeries fail, cross-checked an independent"
echo "verifier, and ran the governed-invoke lifecycle — all locally."
echo "Scope reminder: local evidence only; see docs/security/THREAT_MODEL.md and"
echo "docs/compliance/non-claims.md for what this does and does not show."
