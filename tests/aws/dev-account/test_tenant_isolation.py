import os
import subprocess
import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_AWS_TESTS") != "true",
    reason="Set RUN_AWS_TESTS=true and provide tenant IAM profiles to run this test.",
)


def test_policy_simulation_denies_cross_tenant_s3():
    required = ["AWS_PROFILE", "GHOST_ARK_TENANT_SLUG"]
    missing = [name for name in required if not os.environ.get(name)]
    assert not missing, f"Missing required environment variables: {missing}"

    result = subprocess.run(
        ["bash", "tools/policy-sim/simulate.sh", "--profile", os.environ["AWS_PROFILE"], "--tenant", os.environ["GHOST_ARK_TENANT_SLUG"]],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "sameTenantDecision=allowed" in result.stdout
    assert "crossTenantDecision=implicitDeny" in result.stdout
