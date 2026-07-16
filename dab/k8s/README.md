# DAB Tier-0 on Kubernetes — Custody-Boundary Demo

Runnable, in-cluster demonstration that a receipt emitted by the DAB **gateway**
is accepted by the **independent verifier** — on Kubernetes, in separate
containers, with the verifier trusting only the public key and the receipt
bytes.

## Run

```bash
bash dab/k8s/run_demo.sh
```

It builds `ghost-ark/dab-tools:local`, **loads it straight into the cluster
node's containerd** (no external registry: `kind load` when the `kind` CLI is
present, otherwise `docker save | ctr import` into the `kindest/node`
container — docker-desktop Kubernetes is itself kind-based), applies the Job +
NetworkPolicy, waits, prints both containers' logs, and exits 0 iff the
in-cluster verifier accepted the receipt.

A recorded run is in [`RECORDED_K8S.txt`](RECORDED_K8S.txt) (verified on
docker-desktop Kubernetes, `kindest/node` v1.34.3, 2026-07-16: init container
emitted a CERTIFIED receipt, the independent verifier container logged
`VERIFIED`, Job `succeeded=1`).

## What runs

- **`dab-roundtrip-job.yaml`** — a Job whose *init* container (`gateway-emit`)
  is the only holder of the signing key; it emits a CERTIFIED receipt into a
  shared `emptyDir`. The *main* container (`verifier`) independently checks it.
  Job success ⇔ the independent verifier accepted the gateway's receipt
  in-cluster. Both containers are non-root, drop all capabilities, and use a
  read-only root filesystem.
- **`custody-networkpolicy.yaml`** — denies all egress (except DNS) from pods
  labeled `dab-role: agent`, encoding the paper's isolation intent: an untrusted
  agent has no external routes; the gateway is the only egress path.

## Deployment sketch (not shipped as runnable YAML)

The full custody boundary co-locates an untrusted agent and the gateway in one
pod sharing a Unix-domain socket (`emptyDir` at `/ipc`), with the agent under
`custody-networkpolicy.yaml` and the gateway as the sole egress. The agent
driver in `dab/agent-runtime/` is a library (commitment/DANF/IPC transport) with
no runnable entrypoint yet, so that end-to-end socket path is documented here
rather than shipped as YAML that would not run. The hermetic `emit-receipt`
path the Job uses exercises the same `build_certified_receipt` signing code, so
the receipt custody + independent verification property is genuinely tested;
what remains unexercised is the socket transport and the agent's own commitment
generation.

## Scope and non-claims

- Single-node cluster; **DEV ed25519 key** (not KMS/HSM/TPM/Nitro attestation).
- Demonstrates that the receipt custody + independent-verification path **runs
  on Kubernetes** — not production key custody, availability, autoscaling, or
  multi-node consensus (that is Tier-1 future work; see
  `docs/defense/DEFENSE_ANCHOR.md`).
- NetworkPolicy enforcement depends on the cluster's CNI; the object applies
  cleanly regardless, but enforcement is a property of the CNI, not a claim of
  this repository.
