SELECT
  tenant_slug,
  receipt_id,
  issued_at,
  digest_sha256,
  signature_algorithm
FROM ghost_ark_receipts
WHERE tenant_slug = '${tenant_slug}'
ORDER BY issued_at DESC
LIMIT 100;
