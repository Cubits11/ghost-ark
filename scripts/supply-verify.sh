#!/bin/bash
set -e
echo "[SUPPLY VERIFICATION] Bounding Subresource Registry..."
npm ci --ignore-scripts --no-audit --no-fund
npx --yes lockfile-lint --path package-lock.json --type npm --validate-https --allowed-hosts npm --validate-integrity
npx @cyclonedx/cyclonedx-npm --output-format JSON --output-file ghost-ark.cdx.json
echo "[SUPPLY] Dependencies cryptographically bound."
