#!/usr/bin/env bash
#
# Ghost-Ark DAB Tier-0 — build, load, and run the in-cluster round-trip on the
# current kube-context. Requires: docker, kubectl, a running cluster, and a
# local registry at localhost:5000 that the cluster can pull from
# (docker-desktop Kubernetes supports this out of the box).
#
#   bash dab/k8s/run_demo.sh
#
# Exit 0 iff the Job's independent verifier accepts the gateway's receipt
# in-cluster.

set -Euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAB="$(cd "$HERE/.." && pwd)"
IMAGE="localhost:5000/dab-tools:local"
NS="ghost-ark-dab"

echo "== context ==";        kubectl config current-context
echo "== ensure registry =="
if ! curl -sf http://localhost:5000/v2/ >/dev/null; then
  docker run -d -p 5000:5000 --restart=always --name registry registry:2 >/dev/null
  sleep 2
fi

echo "== build + push image =="
docker build -f "$DAB/Dockerfile" -t "$IMAGE" "$DAB"
docker push "$IMAGE"

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
