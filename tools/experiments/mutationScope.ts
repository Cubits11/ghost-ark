/**
 * E10 mutation-score scope: the declared (source, tests) pair under measurement.
 *
 * This file is the pre-registration for experiment E10, in the same sense that
 * `kernelAlphabet.ts` pre-registers E1's consumer intents. Editing it to make a
 * number look better is visible in review, and `mutationScope.test.ts` checks
 * both halves against the real import graph.
 *
 * WHY A DECLARED SCOPE AT ALL
 *
 * A mutation score is a proportion, and the repository's empirical rules forbid
 * a proportion without its denominator. For mutation testing the denominator is
 * two-sided and both sides can be gamed:
 *
 *   - Shrinking `kernelFiles` raises the score by removing hard-to-kill code.
 *   - Shrinking `testFiles` LOWERS the score (fewer killers), so it cannot be
 *     used to inflate — but it can be used to make a *later* pass look like an
 *     improvement. Pinning it removes that move too.
 *
 * WHAT "TRUST KERNEL" MEANS HERE
 *
 * The files whose corruption would let a receipt verify that should not, or fail
 * to verify one that should: canonical form, admission, digest, signature,
 * emission, chain linkage, key identity. `AGENTS.md` names five of these under
 * "Be careful with"; the remaining five are the modules those five delegate
 * integrity decisions to.
 *
 * Deliberately EXCLUDED, with reasons, because an unexplained exclusion is the
 * thing this file exists to prevent:
 *
 *   - `receipts/repository.ts`, `inMemoryReceiptRepository.ts`,
 *     `checkpointRepository.ts` — storage adapters. Corruption loses or
 *     duplicates receipts; it does not forge one. Availability, not integrity.
 *   - `receipts/schema.ts` — generated/derived zod shape, no hand-written
 *     decision logic to mutate meaningfully.
 *   - `receipts/v2/` — the v2 emission path is a prototype behind a flag, not
 *     the shipped trust kernel. Measuring it would mix maturity tiers.
 *   - `receipt-schema/receipt.ts`, `claimEnvelope.ts`,
 *     `semanticAuditReceipt.ts` — type/shape declarations.
 *   - `ledgerAnchoredRevocation.ts` — revocation is a separate invariant set
 *     with its own proof obligations (AUTHENTICATED_REVOCATION_INVARIANTS.md);
 *     folding it in here would blur two measurements into one number.
 *
 * These exclusions bound E10's claim: it measures test strength over the
 * receipt integrity path, NOT over the repository as a whole. A repo-wide
 * mutation score is not reported because it has not been run.
 */

/** Source files whose mutants E10 counts. Repo-relative, POSIX separators. */
const KERNEL_FILES = [
  "packages/enforcement-runtime/src/receipts/canonical.ts",
  "packages/enforcement-runtime/src/receipts/chain.ts",
  "packages/enforcement-runtime/src/receipts/emission.ts",
  "packages/enforcement-runtime/src/receipts/keyManifest.ts",
  "packages/enforcement-runtime/src/receipts/kmsSigner.ts",
  "packages/enforcement-runtime/src/receipts/kmsVerifier.ts",
  "packages/enforcement-runtime/src/receipts/signer.ts",
  "packages/enforcement-runtime/src/receipts/verifier.ts",
  "packages/receipt-schema/src/hashCanonicalization.ts",
  "packages/receipt-schema/src/strictJsonAdmission.ts"
] as const;

/**
 * Test files Stryker is allowed to run when hunting killers.
 *
 * Derived from the import graph, not from intuition: every test file that
 * transitively imports at least one entry of KERNEL_FILES belongs here, and
 * `mutationScope.test.ts` recomputes that closure and fails on drift.
 */
const TEST_FILES = [
  "packages/google-cloud/test/receipts.test.ts",
  "tests/differential/cloudParity.test.ts",
  "tests/differential/cloudVsLocalLedger.test.ts",
  "tests/differential/nodeIndependentVerifier.test.ts",
  "tests/differential/pythonVerifierCorpus.test.ts",
  "tests/differential/receiptRoundTrip.test.ts",
  "tests/differential/receiptV2Parity.test.ts",
  "tests/integration/api/auth.test.ts",
  "tests/integration/api/createReceipt.test.ts",
  "tests/integration/api/tenantBoundary.test.ts",
  "tests/integration/cloud/bigqueryInsert.test.ts",
  "tests/integration/cloud/bucketUpload.test.ts",
  "tests/integration/cloud/checkpointReplay.test.ts",
  "tests/integration/cloud/concurrentUpload.test.ts",
  "tests/integration/cloud/receiptPublication.test.ts",
  "tests/integration/cloud/receiptRecovery.test.ts",
  "tests/integration/governedInvokeV2Custody.test.ts",
  "tests/integration/mMeasurementE2E.test.ts",
  "tests/integration/repro/receipt-reproducibility.test.ts",
  "tests/integration/test_governedInvokeLifecycle.test.ts",
  "tests/integration/tools/phase567Verify.test.ts",
  "tests/integration/tools/receiptVerify.test.ts",
  "tests/security/policy-fuzzer.test.ts",
  "tests/security/receipt-negative-corpus.test.ts",
  "tests/security/tenantBoundary.test.ts",
  "tests/security/test_governedInvokeTenantBoundary.test.ts",
  "tests/unit/api/test_governedInvokeSecretConfig.test.ts",
  "tests/unit/api/test_invokeGovernedModelAllowlist.test.ts",
  "tests/unit/api/test_searchEvidenceSigv4.test.ts",
  "tests/unit/attestation/runtimeAttestation.test.ts",
  "tests/unit/enforcement-runtime/bedrock/test_guardrails.test.ts",
  "tests/unit/enforcement-runtime/gateway/sidecarProxy.test.ts",
  "tests/unit/enforcement-runtime/policy/test_compiler.test.ts",
  "tests/unit/enforcement-runtime/policy/test_conflicts.test.ts",
  "tests/unit/enforcement-runtime/policy/test_evaluator.test.ts",
  "tests/unit/enforcement-runtime/policy/test_policyRepository.test.ts",
  "tests/unit/enforcement-runtime/policy/test_strictPolicyMode.test.ts",
  "tests/unit/enforcement-runtime/receipts/repository.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_canonical.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_canonical_branches.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_checkpoint.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_decisionReceiptEmission.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_emission_branches.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_hash_chain.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_hash_chain_negative.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_keyManifest_branches.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_key_manifest.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_kmsDecisionReceiptVerification.test.ts",
  // Added 2026-08-12: drives signCanonical's three rejection branches with
  // adversarial Sign RESPONSES (missing signature, missing/alias/mismatched
  // key attestation). Those branches had zero coverage in E10's first sweeps —
  // 6 no-coverage mutants and 7 survivors on kmsSigner.ts, the weakest file.
  "tests/unit/enforcement-runtime/receipts/test_kmsSigner_attestation.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_kmsVerifier_branches.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_ledgerAnchoredRevocation.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_sign_verify.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_signer_branches.test.ts",
  "tests/unit/enforcement-runtime/receipts/test_strict_json_admission.test.ts",
  "tests/unit/enforcement-runtime/receipts/v2/emissionV2.test.ts",
  "tests/unit/enforcement-runtime/runtime/test_failClosed.test.ts",
  "tests/unit/enforcement-runtime/runtime/test_governedInvoke.test.ts",
  "tests/unit/enforcement-runtime/runtime/test_retrievalProviderMode.test.ts",
  "tests/unit/enforcement-runtime/tenancy/test_trustedTenantSource.test.ts",
  "tests/unit/enforcement-runtime/vault/test_consent.test.ts",
  "tests/unit/enforcement-runtime/vault/test_delete_export.test.ts",
  "tests/unit/enforcement-runtime/vault/test_dynamodbVaultShape.test.ts",
  "tests/unit/enforcement-runtime/vault/test_memory_suppression.test.ts",
  "tests/unit/enforcement-runtime/vault/test_ttl_filtering.test.ts",
  "tests/unit/experiments/compromisedSigner.test.ts",
  "tests/unit/experiments/kernelCensus.test.ts",
  // Added 2026-08-12 with E13. Not a judgement call: the invariant in
  // mutationScope.test.ts requires this list to EQUAL the set of tests that
  // transitively import the trust kernel, and E13 reaches it through E1's
  // `classify`. Adding killers can only raise a score, so every E10 figure
  // recorded before this date is a lower bound with respect to it.
  "tests/unit/experiments/kernelComposition.test.ts",
  "tests/unit/experiments/kernelProbe.test.ts",
  "tests/unit/experiments/optionConfusionAndFuzz.test.ts",
  "tests/unit/experiments/randomizedKernel.test.ts",
  "tests/unit/experiments/thirdPartyKernel.test.ts",
  // Added 2026-08-12 with E14. Reaches the kernel through the E14 harness,
  // which drives the real verifier as the comparison arm. Same rule as E13
  // above: the invariant is import-closure equality, not a judgement about
  // killing power, and adding killers can only raise a score — so every E10
  // figure recorded before this date is a lower bound with respect to it.
  "tests/unit/experiments/thirdPartyVerifier.test.ts",
  "tests/unit/policy-compiler/policyCounterexampleEngine.test.ts",
  "tests/unit/policy-compiler/tenantNamespace.test.ts",
  "tests/unit/proofs/receiptProof.test.ts",
  "tests/unit/receipt-schema/hashCanonicalization.test.ts",
  "tests/unit/receipt-schema/hashCanonicalizationMutants.test.ts",
  "tests/unit/receipt-schema/strictJsonAdmissionMutants.test.ts",
  // Reaches the kernel through e1KernelCensus -> canonicalizerArms ->
  // hashCanonicalization + strictJsonAdmission. Declared because the rule is
  // import-closure equality, not because it is a strong killer: it exercises
  // the verdict classifier and the pathology alphabet, and touches the
  // canonicalizer only transitively. Added 2026-08-04 with the standalone probe.
  "tests/unit/repo-hygiene/kernelProbeStandalone.test.ts",
  "tests/unit/research-frontier/stateForker.test.ts",
  "tests/unit/research-frontier/transparencyArtifacts.test.ts",
  "tests/unit/signing/signer.test.ts",
  "tests/unit/tools/test_governedInvokeScripts.test.ts",
  "tests/unit/tools/test_supervisedAwsRuntimeValidation.test.ts"
] as const;

export const MUTATION_TEST_SCOPE = {
  kernelFiles: KERNEL_FILES,
  testFiles: TEST_FILES
} as const;

export type MutationTestScope = typeof MUTATION_TEST_SCOPE;
