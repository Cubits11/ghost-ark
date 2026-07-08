import json
import os
import re
from typing import Any, Dict, List, Optional


TENANT_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,47}$")
TRUSTED_TENANT_SOURCES_ENV = "GHOST_ARK_TRUSTED_TENANT_SOURCES"


class TrustedTenantSourceError(ValueError):
    pass


def assert_trusted_tenant_source(
    *,
    kind: str,
    declared_tenant_slug: str,
    source_name: Optional[str] = None,
    source_arn: Optional[str] = None,
    key: Optional[str] = None,
    input_path: Optional[str] = None,
    output_path: Optional[str] = None,
) -> str:
    if not TENANT_SLUG_RE.match(declared_tenant_slug or ""):
        raise TrustedTenantSourceError(f"invalid declared tenant slug: {declared_tenant_slug!r}")

    for entry in _trusted_sources():
        if _matches(
            entry,
            kind=kind,
            tenant_slug=declared_tenant_slug,
            source_name=source_name,
            source_arn=source_arn,
            key=key,
            input_path=input_path,
            output_path=output_path,
        ):
            return declared_tenant_slug

    raise TrustedTenantSourceError(
        "tenant source is not trusted for declared tenant: "
        f"kind={kind!r} tenant={declared_tenant_slug!r} source_name={source_name!r} "
        f"source_arn={source_arn!r} input_path={input_path!r} output_path={output_path!r}"
    )


def _trusted_sources() -> List[Dict[str, str]]:
    raw = os.environ.get(TRUSTED_TENANT_SOURCES_ENV, "").strip()
    if not raw:
        raise TrustedTenantSourceError(f"missing trusted tenant source registry: {TRUSTED_TENANT_SOURCES_ENV}")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TrustedTenantSourceError(f"trusted tenant source registry must be valid JSON: {exc}") from exc

    if not isinstance(parsed, list):
        raise TrustedTenantSourceError("trusted tenant source registry must be a JSON array")

    return [_parse_entry(entry, index) for index, entry in enumerate(parsed)]


def _parse_entry(value: Any, index: int) -> Dict[str, str]:
    if not isinstance(value, dict):
        raise TrustedTenantSourceError(f"trusted tenant source entry {index} must be an object")

    tenant_slug = _string(value.get("tenantSlug"))
    if not tenant_slug or not TENANT_SLUG_RE.match(tenant_slug):
        raise TrustedTenantSourceError(f"trusted tenant source entry {index} has invalid tenantSlug")

    entry = {
        key: parsed
        for key in ("kind", "sourceArn", "sourceName", "keyPrefix", "inputPrefix", "outputPrefix")
        if (parsed := _string(value.get(key)))
    }
    entry["tenantSlug"] = tenant_slug

    if entry.get("kind") not in (None, "s3", "sqs", "glue"):
        raise TrustedTenantSourceError(f"trusted tenant source entry {index} has invalid kind")
    if not entry.get("sourceArn") and not entry.get("sourceName"):
        raise TrustedTenantSourceError(f"trusted tenant source entry {index} must include sourceArn or sourceName")
    return entry


def _matches(
    entry: Dict[str, str],
    *,
    kind: str,
    tenant_slug: str,
    source_name: Optional[str],
    source_arn: Optional[str],
    key: Optional[str],
    input_path: Optional[str],
    output_path: Optional[str],
) -> bool:
    if entry.get("kind") and entry["kind"] != kind:
        return False
    if entry["tenantSlug"] != tenant_slug:
        return False
    if entry.get("sourceArn") and entry["sourceArn"] != source_arn:
        return False
    if entry.get("sourceName") and entry["sourceName"] != source_name:
        return False
    if entry.get("keyPrefix") and not (key or "").startswith(entry["keyPrefix"]):
        return False
    if entry.get("inputPrefix") and not (input_path or "").startswith(entry["inputPrefix"]):
        return False
    if entry.get("outputPrefix") and not (output_path or "").startswith(entry["outputPrefix"]):
        return False
    return bool(entry.get("sourceArn") or entry.get("sourceName"))


def _string(value: Any) -> Optional[str]:
    return value.strip() if isinstance(value, str) and value.strip() else None
