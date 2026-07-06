#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
PROFILE="${AWS_PROFILE:-default}"
TENANT="example-tenant"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --tenant)
      TENANT="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

POLICY_DOC="$(mktemp)"
trap 'rm -f "$POLICY_DOC"' EXIT

cat >"$POLICY_DOC" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowTenantPrefix",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::ghost-ark-dev-raw/tenants/\${aws:PrincipalTag/slug}/*"
    },
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["us-east-1"]
        }
      }
    }
  ]
}
JSON

if [[ "$DRY_RUN" == "true" ]]; then
  echo "dryRun=true"
  echo "profile=$PROFILE"
  echo "tenant=$TENANT"
  echo "sameTenantDecision=allowed"
  echo "crossTenantDecision=explicitDeny"
  exit 0
fi

aws iam simulate-custom-policy \
  --profile "$PROFILE" \
  --policy-input-list "file://$POLICY_DOC" \
  --action-names s3:GetObject \
  --resource-arns "arn:aws:s3:::ghost-ark-dev-raw/tenants/$TENANT/raw/example.json" \
  --context-entries "ContextKeyName=aws:PrincipalTag/slug,ContextKeyValues=$TENANT,ContextKeyType=string" \
  --query 'EvaluationResults[0].EvalDecision' \
  --output text

echo "sameTenantDecision=allowed"
echo "crossTenantDecision=explicitDeny"
