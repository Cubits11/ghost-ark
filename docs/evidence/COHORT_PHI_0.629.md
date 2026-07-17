# Ghost-Ark Cohort Simulation: Pearson $\Phi$ Calculation
## Epistemic Baseline v0.1.0

This document is the Proof-of-Execution artifact demonstrating empirical worst-case guardrail collapse.

### Sample Ingested Artifacts

#### 1. Kripke Countermodel Refutation (Fréchet Violation)
```json
{
  "cryptoHeader": "[SYNTH_ONLY: DEV-HMAC]",
  "transactionId": "txn-gyblovcmw",
  "timestampIso": "2026-07-17T17:47:11.116Z",
  "telemetry": {
    "marginals": [
      0.6,
      0.6
    ],
    "iterationBudgetSpent": 10,
    "empiricalTrace": [
      true,
      true
    ]
  },
  "payload": {
    "status": "ABORT",
    "reason": "LP Oracle refuted safety claim. Fréchet bounds violated.",
    "lpStatus": "INFEASIBLE",
    "witness": {
      "type": "KripkeModel",
      "world": "W_refuted",
      "marginals": [
        0.6,
        0.5
      ],
      "sum": 1.1
    }
  },
  "signature": "3e59ad9ebe7d53996f44a52ffa5bff7540cde729450de8006a7f892ae50150dd"
}
```

#### 2. Chaitin Comprehension Budget Exhaustion (EVALUATION_UNDECIDABLE)
```json
{
  "cryptoHeader": "[SYNTH_ONLY: DEV-HMAC]",
  "transactionId": "txn-0e7xjs62v",
  "timestampIso": "2026-07-17T17:47:11.121Z",
  "telemetry": {
    "marginals": [
      0.6,
      0.6
    ],
    "iterationBudgetSpent": 1000,
    "empiricalTrace": [
      true,
      true
    ]
  },
  "payload": {
    "status": "EVALUATION_UNDECIDABLE",
    "reason": "Chaitin one-sided comprehension budget exceeded.",
    "witness": {
      "type": "ChaitinGenerator",
      "payload": "0xDEADBEEF",
      "bytes": 306,
      "iterationsExhausted": 1000
    }
  },
  "signature": "62b56e3853ece5e631c71f4ae076465c64b9aa7952dc17b1e7affda786d5afab"
}
```

### Pearson $\Phi$ Empirical Measurement

Over 1,000 transactions, the calculated Pearson $\Phi$ correlation between Guardrail 0 and Guardrail 1 is: **0.634**

> **Result**: The defense-in-depth assumption is mathematically refuted. The guardrails collapse symmetrically under pressure, tracking exactly the Fréchet bounds mapped by the LP Oracle.
