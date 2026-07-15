import * as http from "http";
import * as https from "https";
import { createHash } from "crypto";
import { canonicalSha256Hex } from "../../../receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../shared/src/errors";
import { IODigester } from "./ioDigester";
import { ProvenanceLabeledEvidence } from "../evidence/provenanceLattice";

/**
 * Reference sidecar transit for the intercept gateway boundary
 * (docs/architecture/ACC_ENFORCEMENT_ARCHITECTURE.md, constraints G1-G7).
 *
 * The agent never talks to the tool; this function does, and it records what
 * actually crossed the wire. The returned evidence is labeled
 * GATEWAY_RECORDED because the boundary computed the digests from the raw
 * response stream — the agent's account of the response is never consulted.
 *
 * This is a local reference implementation. It carries no deployment,
 * isolation, or SSRF-safety claim beyond the exact-match destination
 * allowlist behavior exercised by its tests.
 */

const toolNamePattern = /^[A-Za-z0-9._:-]{1,256}$/u;

export interface GovernedTransitRequest {
  targetUrl: string;
  toolName: string;
  requestBody: Buffer;
  sequenceNum: number;
  /** Exact-match "host:port" entries. Empty list means every destination is refused. */
  allowedDestinations: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface TransitRecord {
  schemaVersion: "ghost.gateway_transit.v1";
  statusCode: number;
  toolName: string;
  sequenceNum: number;
  requestDigest: string;
  responseDigest: string;
  body: Buffer;
  responseEvidence: ProvenanceLabeledEvidence;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

function transitError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.gateway_transit.v1", ...context });
}

function destinationKey(url: URL): string {
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return `${url.hostname}:${port}`;
}

function assertTransitRequestShape(input: GovernedTransitRequest): URL {
  if (!toolNamePattern.test(input.toolName)) {
    throw transitError("toolName must be 1-256 characters of URL-safe text.", { field: "toolName" });
  }
  if (!Buffer.isBuffer(input.requestBody)) {
    throw transitError("requestBody must be a Buffer of the exact bytes to transmit.", { field: "requestBody" });
  }
  if (!Number.isSafeInteger(input.sequenceNum) || input.sequenceNum < 0) {
    throw transitError("sequenceNum must be a non-negative safe integer.", { field: "sequenceNum" });
  }
  if (!Array.isArray(input.allowedDestinations)) {
    throw transitError("allowedDestinations must be an explicit list; there is no default-open mode.", {
      field: "allowedDestinations"
    });
  }

  let url: URL;
  try {
    url = new URL(input.targetUrl);
  } catch {
    throw transitError("targetUrl is not a valid URL.", { field: "targetUrl" });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw transitError("Transit supports http and https destinations only.", { observed: url.protocol });
  }

  const key = destinationKey(url);
  if (!input.allowedDestinations.includes(key)) {
    throw transitError("Destination is not in the transit allowlist; failing closed.", { destination: key });
  }

  return url;
}

export async function executeGovernedTransit(input: GovernedTransitRequest): Promise<TransitRecord> {
  const url = assertTransitRequestShape(input);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const requestDigest = `sha256:${createHash("sha256").update(input.requestBody).digest("hex")}`;
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<TransitRecord>((resolve, reject) => {
    let settled = false;
    const fail = (message: string): void => {
      if (!settled) {
        settled = true;
        reject(transitError(`Transit boundary severed: ${message}`, { toolName: input.toolName }));
      }
    };

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port !== "" ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Length": Buffer.byteLength(input.requestBody),
          "Content-Type": "application/json"
        }
      },
      (res) => {
        if (typeof res.statusCode !== "number") {
          res.destroy();
          fail("response carried no status code; refusing to fabricate one");
          return;
        }
        const statusCode = res.statusCode;

        const digester = new IODigester();
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on("error", (error) => fail(error.message));
        digester.on("error", (error) => fail(error.message));

        digester.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxResponseBytes) {
            req.destroy();
            fail(`response exceeded the ${maxResponseBytes}-byte transit cap`);
            return;
          }
          chunks.push(chunk);
        });

        digester.on("end", () => {
          if (settled) {
            return;
          }
          const responseDigest = digester.getDigest();
          const evidenceId = `evd_${canonicalSha256Hex({
            toolName: input.toolName,
            sequenceNum: input.sequenceNum,
            requestDigest,
            responseDigest
          })}`;

          settled = true;
          resolve({
            schemaVersion: "ghost.gateway_transit.v1",
            statusCode,
            toolName: input.toolName,
            sequenceNum: input.sequenceNum,
            requestDigest,
            responseDigest,
            body: Buffer.concat(chunks),
            responseEvidence: {
              evidenceId,
              contentDigest: responseDigest,
              sourceId: input.toolName,
              provenanceClass: "GATEWAY_RECORDED"
            }
          });
        });

        res.pipe(digester);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      fail(`no response within ${timeoutMs}ms`);
    });
    req.on("error", (error) => fail(error.message));
    req.end(input.requestBody);
  });
}
