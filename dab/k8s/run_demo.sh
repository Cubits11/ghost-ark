#!/usr/bin/env bash
#
# Ghost-Ark DAB Tier-0 — build, load, and run the in-cluster round-trip on the
# current kube-context. Requires: docker, kubectl, a running cluster.
#
#   bash dab/k8s/run_demo.sh
#
# Image loading (no external registry needed):
#   * `kind` CLI present            -> `kind load docker-image`
#   * kind-based node (docker-desktop Kubernetes IS kind-based: the node is a
#     kindest/node container) -> `docker save | docker exec <node> ctr import`
# Exit 0 iff the Job's independent verifier accepts the gateway's receipt
# in-cluster.

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"
IMAGE="ghost-ark/dab-tools:local"
NS="ghost-ark-dab"

echo "== context ==";        kubectl config current-context

echo "== build image =="
docker build -f "$DAB/Dockerfile" -t "$IMAGE" "$DAB"

echo "== load image into the cluster (no registry) =="
if command -v kind >/dev/null 2>&1 && kind get clusters >/dev/null 2>&1; then
  kind load docker-image "$IMAGE" --name "$(kind get clusters | head -1)"
else
  # docker-desktop Kubernetes is kind-based; find the control-plane node
  # container and import straight into its containerd k8s.io namespace.
  NODE="$(docker ps --format '{{.Names}} {{.Image}}' | awk '/kindest\/node/ {print $1; exit}')"
  if [ -z "${NODE:-}" ]; then
    echo "Could not find a kindest/node container to load the image into." >&2
    echo "Point kubectl at a kind or docker-desktop Kubernetes cluster." >&2
    exit 3
  fi
  echo "loading into node: $NODE"
  docker save "$IMAGE" | docker exec -i "$NODE" ctr -n k8s.io images import -
fi

echo "== apply manifests =="
kubectl delete job dab-roundtrip -n "$NS" --ignore-not-found >/dev/null 2>&1 || true
kubectl apply -f "$HERE/dab-roundtrip-job.yaml"
kubectl apply -f "$HERE/custody-networkpolicy.yaml"

echo "== wait for Job =="
set +e
kubectl wait --for=condition=complete job/dab-roundtrip -n "$NS" --timeout=120s
COMPLETE=$?
if [ "$COMPLETE" -ne 0 ]; then
  kubectl wait --for=condition=failed job/dab-roundtrip -n "$NS" --timeout=5s >/dev/null 2>&1
fi
set -e

POD="$(kubectl get pods -n "$NS" -l app=dab-roundtrip -o jsonpath='{.items[0].metadata.name}')"
echo "== gateway (init) logs =="
kubectl logs "$POD" -n "$NS" -c gateway-emit || true
echo "== independent verifier logs =="
kubectl logs "$POD" -n "$NS" -c verifier || true

echo "== Job status =="
kubectl get job dab-roundtrip -n "$NS" -o jsonpath='{.status}'; echo

if [ "$COMPLETE" -eq 0 ]; then
  echo "K8S ROUND-TRIP: OK (independent verifier accepted the gateway receipt in-cluster)"
  exit 0
else
  echo "K8S ROUND-TRIP: FAILED"
  exit 1
fi
