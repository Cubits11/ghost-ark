/**
 * Type surface for the conformance harness, for consumers inside this
 * repository's test suite. The shipped artifact is plain JavaScript by design —
 * it must run with zero build step — so types live in this sibling declaration,
 * following the tools/assumptions and tools/claims convention.
 */

export interface ConformanceCaseResult {
  readonly case_id: string;
  readonly expected_verdict: "PASS" | "FAIL";
  readonly observed_verdict: "PASS" | "FAIL";
  readonly verdict_ok: boolean;
  readonly expected_failing_checks: readonly string[] | null;
  readonly observed_failed_checks: readonly string[] | null;
  readonly failing_check: "match" | "mismatch" | "not-evaluated" | "not-applicable";
  readonly identity: "match" | "mismatch" | "not-evaluated" | "not-applicable";
}

export interface ConformanceReport {
  readonly schema_version: "ghost.receipt_conformance_report.v1";
  readonly suite_version: string;
  readonly candidate: string;
  readonly totals: {
    readonly cases: number;
    readonly verdict_conformant: number;
    readonly verdict_mismatches: number;
    readonly failing_check_evaluated: number;
    readonly failing_check_mismatches: number;
    readonly identity_evaluated: number;
    readonly identity_mismatches: number;
  };
  readonly conformant: boolean;
  readonly results: readonly ConformanceCaseResult[];
  readonly non_claim: string;
}

export declare function runSuite(manifestPath: string, command: readonly string[]): ConformanceReport;
