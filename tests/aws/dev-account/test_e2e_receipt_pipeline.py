import os
import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_AWS_TESTS") != "true",
    reason="Set RUN_AWS_TESTS=true and provide a dev AWS account to run this test.",
)


def test_e2e_receipt_pipeline_contract():
    required = [
        "GHOST_ARK_API_URL",
        "GHOST_ARK_TENANT_SLUG",
        "GHOST_ARK_RAW_BUCKET",
        "GHOST_ARK_CURATED_BUCKET",
    ]
    missing = [name for name in required if not os.environ.get(name)]
    assert not missing, f"Missing required environment variables: {missing}"
