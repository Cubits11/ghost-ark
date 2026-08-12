# Ghost-Ark — USENIX Artifact Evaluation orchestration
#
# One command for reviewers:   make reproduce
#
# Every target runs REAL commands and reports REAL status. Nothing here
# manufactures a green result. See docs/artifact/repository_inventory.md for the
# honest, evidence-backed status of each stage (including known HEAD blockers).

SHELL := /bin/bash
.DEFAULT_GOAL := help

# --- package-manager detection (npm ci vs pnpm --frozen-lockfile) --------------
ifneq ("$(wildcard pnpm-lock.yaml)","")
  PKG_INSTALL := pnpm install --frozen-lockfile
else ifneq ("$(wildcard package-lock.json)","")
  PKG_INSTALL := npm ci
else
  PKG_INSTALL := npm install
endif

VITEST_TIMEOUT_MS ?= 60000

.PHONY: help bootstrap lint build proof unit attack benchmark dissertation \
        artifact-report reproduce ci-check audit clean

help: ## Show this help
	@echo "Ghost-Ark Artifact Evaluation — make targets"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Primary entrypoint: make reproduce"

bootstrap: ## Install deps ($(PKG_INSTALL)) and fetch the pinned, digest-verified tla2tools.jar
	@echo "[bootstrap] $(PKG_INSTALL)"
	$(PKG_INSTALL)
# This target hardcoded `v1.8.0` and fetched it with NO integrity check, while
# three other files pinned the same tag at three different digests. It was the
# weakest of the five acquisition paths and the only one that would have accepted
# a substituted jar silently. It now reads the version AND the digest from
# scripts/run-proofs.sh -- the single source of truth -- and verifies both, so a
# drifting upstream asset fails here the same way it fails in CI.
	@echo "[bootstrap] ensuring tla2tools.jar (pin read from scripts/run-proofs.sh)"
	@bash -c 'set -euo pipefail; \
	  VER=$$(grep -oE "^TLA_TOOLS_VERSION=\"[^\"]+\"" scripts/run-proofs.sh | cut -d\" -f2); \
	  SHA=$$(grep -oE "^TLA_TOOLS_SHA256=\"[0-9a-f]{64}\"" scripts/run-proofs.sh | cut -d\" -f2); \
	  test -n "$$VER" && test -n "$$SHA" || { echo "[bootstrap] cannot read the tla2tools pin" >&2; exit 1; }; \
	  JAR=.cache/tla/tla2tools.jar; \
	  sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$$1" | awk "{print \$$1}"; else shasum -a 256 "$$1" | awk "{print \$$1}"; fi; }; \
	  if [ -f "$$JAR" ] && [ "$$(sha_of $$JAR)" = "$$SHA" ]; then \
	    echo "[bootstrap] tla2tools $$VER already present and verified"; \
	  else \
	    mkdir -p .cache/tla; \
	    curl -fsSL -o "$$JAR" "https://github.com/tlaplus/tlaplus/releases/download/$$VER/tla2tools.jar"; \
	    GOT=$$(sha_of "$$JAR"); \
	    if [ "$$GOT" != "$$SHA" ]; then \
	      echo "[bootstrap] tla2tools.jar sha256 $$GOT != pinned $$SHA" >&2; \
	      echo "[bootstrap] refusing to run TLC against an unrecognised toolchain" >&2; \
	      rm -f "$$JAR"; exit 1; \
	    fi; \
	    echo "[bootstrap] tla2tools $$VER verified: $$GOT"; \
	  fi'
	@echo "[bootstrap] done"

lint: ## Typecheck the TypeScript workspace (tsc --noEmit)
	npm run lint

build: ## Full TypeScript build (tsc emit to dist/)
	npm run build

proof: ## Run all TLA+ proofs (baselines must pass; mutants must violate)
	bash scripts/run-proofs.sh

unit: ## Run the full vitest suite with a load-tolerant timeout
	npx vitest run --test-timeout=$(VITEST_TIMEOUT_MS)

attack: ## Run adversarial suites (root security tests + DAB Tier-0 bench)
	bash scripts/run-attacks.sh

benchmark: ## Run performance + formal-game benchmarks -> artifacts/benchmarks/
	bash scripts/run-benchmarks.sh

dissertation: ## Build the dissertation PDF (claim-gated; needs pandoc+latexmk)
	bash docs/dissertation/build_paper.sh

artifact-report: ## Aggregate stage status -> artifacts/reports/aec_summary.{json,md}
	node tools/artifact/aec-report.mjs

reproduce: ## FULL honest reproduction: build->claims->proof->unit->attack->benchmark->dissertation->report
	bash scripts/reproduce.sh

ci-check: ## Deterministic CI gate: lint + claims + proof + unit + attack (no PDF/bench)
	npm run lint
	npm run scan:claims
	bash scripts/run-proofs.sh
	npx vitest run --test-timeout=$(VITEST_TIMEOUT_MS)
	bash scripts/run-attacks.sh

audit: ## Re-run the read-only Phase-1 audit gates (points at the inventory)
	@echo "See docs/artifact/repository_inventory.md for the full audit."
	npm run lint
	-npm run scan:claims
	-bash scripts/run-proofs.sh

clean: ## Remove generated artifacts, build output, and caches
	rm -rf artifacts dist coverage cdk.out .cache
	@echo "[clean] done"
