#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
PROFILE="${AWS_PROFILE:-default}"
TENANT="example-tenant"
CROSS_TENANT="other-tenant"
REGION="${AWS_REGION:-us-east-1}"
BUCKET="ghost-ark-dev-raw"
ACTION="s3:GetObject"

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
    --cross-tenant)
      CROSS_TENANT="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --bucket)
      BUCKET="$2"
      shift 2
      ;;
    --action)
      ACTION="$2"
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
      "Resource": "arn:aws:s3:::$BUCKET/tenants/\${aws:PrincipalTag/slug}/*"
    },
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["$REGION"]
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
  echo "crossTenant=$CROSS_TENANT"
  echo "region=$REGION"
  echo "bucket=$BUCKET"
  echo "action=$ACTION"
  echo "sameTenantDecision=allowed"
  echo "crossTenantDecision=implicitDeny"
  exit 0
fi

simulate_decision() {
  local resource_arn="$1"

  aws iam simulate-custom-policy \
    --profile "$PROFILE" \
    --policy-input-list "file://$POLICY_DOC" \
    --action-names "$ACTION" \
    --resource-arns "$resource_arn" \
    --context-entries \
      "ContextKeyName=aws:PrincipalTag/slug,ContextKeyValues=$TENANT,ContextKeyType=string" \
      "ContextKeyName=aws:RequestedRegion,ContextKeyValues=$REGION,ContextKeyType=string" \
    --query 'EvaluationResults[0].EvalDecision' \
    --output text
}

assert_decision() {
  local label="$1"
  local actual="$2"
  local expected="$3"

  echo "$label=$actual"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected $label to be $expected, got $actual" >&2
    exit 1
  fi
}

same_decision="$(simulate_decision "arn:aws:s3:::$BUCKET/tenants/$TENANT/raw/example.json")"
cross_decision="$(simulate_decision "arn:aws:s3:::$BUCKET/tenants/$CROSS_TENANT/raw/example.json")"

assert_decision "sameTenantDecision" "$same_decision" "allowed"
assert_decision "crossTenantDecision" "$cross_decision" "implicitDeny"
