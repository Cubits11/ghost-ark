import { describe, expect, it } from "vitest";
import { canonicalSha256Hex, canonicalize } from "../../../packages/receipt-schema/src/hashCanonicalization";
import { ValidationError } from "../../../packages/shared/src/errors";
import { buildReceiptPayload, receiptDigest, BuildReceiptPayloadInput } from "../../../packages/receipt-schema/src/receipt";

const undefinedValueErrorMessage =
  "Canonical JSON cannot encode undefined values. Use explicit null or omit the key structurally.";

function expectValidationError(value: unknown, message?: string, context: Record<string, unknown> = {}): void {
  let thrown: unknown;

  try {
    canonicalize(value);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationError);

  if (message) {
    expect((thrown as ValidationError).message).toBe(message);
  }

  if (Object.keys(context).length > 0) {
    expect((thrown as ValidationError).context).toMatchObject(context);
  }
}

function expectUndefinedValidationError(value: unknown, context: Record<string, unknown>): void {
  expectValidationError(value, undefinedValueErrorMessage, {
    type: "undefined_value_encountered",
    ...context
  });
}

const subjectKinds = ["dataset-version", "evidence-object", "claim", "export-pack", "transform-run"] as const;
const classifications = ["internal", "confidential", "restricted", "public"] as const;
const tenants = ["acme-lab", "beta-lab", "gamma-lab", "delta-lab"] as const;
const hashes = ["a", "b", "c", "d", "e"].map((character) => character.repeat(64));

function regressionFixtureInput(index: number): BuildReceiptPayloadInput {
  const tenantSlug = tenants[index % tenants.length];
  const kind = subjectKinds[index % subjectKinds.length];
  const classification = classifications[index % classifications.length];

  return {
    tenantSlug,
    issuedAt: `2026-07-${String((index % 20) + 1).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:15:30.000Z`,
    subject: {
      kind,
      id: `${kind}-${index + 1}`,
      ...(index % 2 === 0 ? { uri: `s3://ghost-ark-fixtures/${tenantSlug}/${kind}-${index + 1}.json` } : {}),
      ...(index % 3 === 0 ? { contentSha256: hashes[index % hashes.length] } : {}),
      metadata: {
        ordinal: index + 1,
        active: index % 2 === 0,
        labels: [`tenant:${tenantSlug}`, `kind:${kind}`],
        override: null,
        nested: { depth: index % 4, stable: true }
      }
    },
    evidenceObjects: [`ev_${String(index + 1).padStart(2, "0")}_b`, `ev_${String(index + 1).padStart(2, "0")}_a`],
    lineageEventIds: [`lin_${String(index + 1).padStart(2, "0")}_b`, `lin_${String(index + 1).padStart(2, "0")}_a`],
    claimIds: [`clm_${String(index + 1).padStart(2, "0")}_b`, `clm_${String(index + 1).padStart(2, "0")}_a`],
    governanceContext: {
      lakeFormationTags: {
        tenant_slug: tenantSlug,
        classification,
        evidence_role: index % 2 === 0 ? "curated" : "receipt"
      },
      columnRestrictions: index % 2 === 0 ? ["tenant_slug", "event_ts", `metric_${index}`] : [],
      policyCompilerVersion: `50.0.${index}`,
      ...(index % 2 === 0 ? { rowFilter: `tenant_slug = '${tenantSlug}' AND fixture_index = ${index}` } : {}),
      ...(index % 3 === 0 ? { iamPolicyHash: hashes[(index + 1) % hashes.length] } : {})
    },
    transform: {
      runId: `fixture-run-${index + 1}`,
      jobName: `canonical-regression-${index + 1}`,
      inputVersion: `input-v${index + 1}`,
      outputVersion: `output-v${index + 1}`,
      parameters: {
        batch: Math.floor(index / 5),
        dryRun: index % 2 === 1,
        thresholds: [0, index + 0.25, index + 0.75],
        notes: null,
        routing: { lane: classification, priority: index % 5 }
      }
    }
  };
}

const regressionFixtureExpectedDigests = [
  "bccde410fb8757618af7d01415d702395b0ca81d0b24914a061b8002db140b60",
  "d01c24117c2eefd91124fc27be669a7c2cb62d30e13bd9d6791d3aa4d1ee0d33",
  "05e10cd44961814a10e0b390bceb6d68292258a1a0a3b2f8153e4dea46c579b4",
  "a8d868091a7c7ea737ae08374bf4472bf6bc7f9f7a4c152ab0fec26bb34bf491",
  "e72afb8a534f061a4b81ffc9c89a61c6c67031456cc14448816932353508fce4",
  "dd93722d6f4bf773101e49920a249cb1cab805affe2d0e6cc145fef20370d2d9",
  "fc052b254dd49af1449c23f2e0142d293756573ccf7b980b16b2bc34afa85dd6",
  "3172bef87c0e6dfb184fb8b5ed9fa06873e47ec08e612a6738a1f6e1cdb407b5",
  "ca18bd92c9e109b7f0047b7052c742a1a4a142646b1a295b5561ea32737af538",
  "eac1949acab236f59b0f4b2cb638c7e50eaaa94af12754be83e23aeb4adaa64e",
  "ab7b3d5c4d6ca24b879af87dd479dbd226f977a268805c3f2ecf924b565c2e6f",
  "e488e82e4eb6893904c5bf582b164a674ab388939bfb75d02939eec6094358cb",
  "978df0daeb3f399526879b1e5b696541402033388b4d72d053022f44bcbfaba7",
  "327862b7b3d59a5fe987d29b8668423dacbf4516fd2e7f6885d9210d81c8f55d",
  "09f45ff20c9eec0c56e156165a9f7abc93c85eeba0524665f9fe52acb79a69fa",
  "3883b7d75c580a39a945c6cd73c2f75851fbcba04f678d1804fb6da468681a48",
  "e899f5adc55b16009b1b4b71b95525d2a3a6dfc7908ddb7a60d37040c9f4c9c7",
  "98d9bdd2df7ed4ebfb047288275349703c04ab36662765297cd6f1e6ec31be1d",
  "7a271e07ce23683c625f58e4c866f972ed5de603f03c5492752ae117b4f96550",
  "872db316f063c52cad2bf9bbdd8264d6f17cf2a18f49445c46617cd53671deae"
] as const;

describe("canonicalization", () => {
  it("orders object keys deterministically", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalSha256Hex({ b: 2, a: 1 })).toBe(canonicalSha256Hex({ a: 1, b: 2 }));
  });

  it("removes insignificant whitespace from canonical objects and arrays", () => {
    expect(canonicalize({ z: [3, 2, 1], a: { y: true, x: null } })).toBe('{"a":{"x":null,"y":true},"z":[3,2,1]}');
  });

  it("preserves explicit array order", () => {
    expect(canonicalSha256Hex(["a", "b"])).not.toBe(canonicalSha256Hex(["b", "a"]));
  });

  it("builds stable receipt IDs for identical payload inputs", () => {
    const input = {
      tenantSlug: "acme-lab",
      subject: { kind: "dataset-version" as const, id: "dataset-a" },
      evidenceObjects: ["ev_b", "ev_a"],
      governanceContext: { lakeFormationTags: { tenant_slug: "acme-lab" }, columnRestrictions: [], policyCompilerVersion: "50.0.0" },
      issuedAt: "2026-07-06T12:00:00.000Z",
      transform: {
        runId: "stable-id-test",
        jobName: "hash-canonicalization",
        inputVersion: "input-v1",
        outputVersion: "output-v1",
        parameters: {}
      }
    };

    const first = buildReceiptPayload(input);
    const second = buildReceiptPayload({ ...input, evidenceObjects: ["ev_a", "ev_b"] });

    expect(first.receiptId).toBe(second.receiptId);
    expect(receiptDigest(first)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects_top_level_undefined", () => {
    expectUndefinedValidationError(undefined, {});
  });

  it("rejects_object_property_undefined", () => {
    expectUndefinedValidationError({ a: "test", b: undefined }, { key: "b" });
  });

  it("rejects_nested_undefined", () => {
    expectUndefinedValidationError({ parent: { child: undefined } }, { key: "child" });
  });

  it("rejects_array_undefined", () => {
    expectUndefinedValidationError(["valid", undefined, "test"], { index: 1 });
  });

  it("rejects sparse array holes as undefined elements", () => {
    const sparse: unknown[] = [];
    sparse[1] = "test";

    expectValidationError(sparse, "Canonical JSON cannot encode sparse arrays", { index: 0 });
  });

  it("preserves_null_semantics", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalSha256Hex({ a: null })).not.toBe(canonicalSha256Hex({}));
  });

  it("normalizes negative zero to 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("rejects Date objects instead of silently normalizing host-runtime values", () => {
    expectValidationError(
      new Date("2026-07-07T00:00:00-04:00"),
      "Canonical JSON cannot encode Date objects. Serialize timestamps as schema-owned ISO strings before signing.",
      { constructor: "Date" }
    );
  });

  it("accepts explicit ISO timestamp strings", () => {
    expect(canonicalize("2026-07-07T04:00:00.000Z")).toBe('"2026-07-07T04:00:00.000Z"');
  });

  it("rejects non-finite numbers", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalize(value)).toThrow(ValidationError);
    }
  });

  it("rejects binary and collection host-runtime objects", () => {
    expectValidationError(Buffer.from("ghost"), "Canonical JSON cannot encode Buffer values. Encode bytes explicitly before signing.", {
      constructor: "Buffer"
    });
    expectValidationError(new Uint8Array([1, 2, 3]), "Canonical JSON cannot encode binary view values. Encode bytes explicitly before signing.", {
      constructor: "Uint8Array"
    });
    expectValidationError(new Map([["a", 1]]), "Canonical JSON cannot encode Map or Set values. Convert them to explicit schema objects before signing.", {
      constructor: "Map"
    });
    expectValidationError(new Set(["a"]), "Canonical JSON cannot encode Map or Set values. Convert them to explicit schema objects before signing.", {
      constructor: "Set"
    });
  });

  it("rejects bigint function and symbol values", () => {
    expectValidationError(1n, "Canonical JSON cannot encode bigint values", { type: "bigint" });
    expectValidationError(() => "ghost", "Canonical JSON cannot encode executable or symbolic values", { type: "function" });
    expectValidationError(Symbol("ghost"), "Canonical JSON cannot encode executable or symbolic values", { type: "symbol" });
  });

  it("rejects class instances", () => {
    class GhostPayload {
      constructor(public readonly tenantSlug: string) {}
    }

    expectValidationError(new GhostPayload("acme-lab"), "Unsupported value in canonical JSON payload", {
      constructor: "GhostPayload"
    });
  });

  it("regression_stability", () => {
    const actualDigests = Array.from({ length: 20 }, (_, index) => receiptDigest(buildReceiptPayload(regressionFixtureInput(index))));

    expect(regressionFixtureExpectedDigests).toHaveLength(20);
    expect(actualDigests).toEqual(regressionFixtureExpectedDigests);
  });
});