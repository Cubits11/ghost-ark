# Ghost-Ark DAB Tier-0 — combined tools image (gateway + independent verifier).
#
# Multi-stage: build both Rust crates with --locked, then ship only the two
# stripped release binaries on a slim glibc runtime. Used by the compose custody
# boundary (dab/docker-compose.yml) and the k8s round-trip Job (dab/k8s/).
#
#   docker build -f dab/Dockerfile -t <ref> dab
#
# Build context is dab/ (see dab/.dockerignore — target/ is excluded).

FROM rust:1-slim AS build
WORKDIR /src
COPY gateway ./gateway
COPY verifier ./verifier
RUN cd gateway  && cargo build --release --locked
RUN cd verifier && cargo build --release --locked

FROM debian:bookworm-slim
# ca-certificates: the gateway's execution path uses reqwest+rustls (TLS) when
# it performs the single authorized outbound request. Not exercised by the
# hermetic emit-receipt mode, but present so the same image serves both.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/gateway/target/release/dab-gateway   /usr/local/bin/dab-gateway
COPY --from=build /src/verifier/target/release/dab-verifier /usr/local/bin/dab-verifier
# Non-root by default; the agent side runs unprivileged and egress-restricted.
RUN useradd --uid 10001 --create-home dab
USER 10001
ENTRYPOINT []
CMD ["dab-gateway"]
