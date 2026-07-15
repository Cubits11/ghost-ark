## PART III — DAB ARCHITECTURE

### The Serialization Trap

A common vulnerability in cross-boundary cryptographic systems is the **Serialization Trap**. When an untrusted environment (TypeScript/V8) serializes a payload differently than the Trusted Computing Base (Rust) parses it, the cryptographic binding shatters. An attacker can construct a payload that TypeScript normalizes into one AST, but Rust deserializes into a completely different AST, effectively tricking the verifier while executing malicious code.

### Declared Action Normal Form (DANF) Audit

The `danf.ts` module attempts to mitigate this by defining a strict canonical representation:
- **Lexicographical Key Sorting**: Mitigates non-deterministic object iteration order.
- **Type Restriction**: Forbids complex prototypes via `isPlainObject()` to prevent prototype pollution at the serialization layer.
- **Unicode Normalization**: Forces `NFC` normalization for all strings to prevent byte-divergence of visually identical homoglyphs.

However, `danf.ts` operates in the untrusted runtime. If V8 is compromised, an attacker can simply hook `JSON.stringify` or `Object.keys` to emit non-canonical bytes. 

### Achieving Cross-Language Serialization Parity

DAB achieves cross-language serialization parity by eliminating AST parsing inside the TCB for the payload itself. 
In `main.rs`, the payload is treated as **opaque bytes**. The Rust gateway does not parse the execution payload into an AST; it merely base64-decodes it and hashes the raw binary representation to derive $C_E$.

The verification invariant is exactly:
$$ C_E = \text{SHA256}(\text{Base64Decode}(\text{Payload})) $$
$$ C_I == C_E $$

Because the gateway never attempts to interpret the payload before hashing, the serialization trap is bypassed. If the attacker mutates the payload to exploit a downstream system, $C_E$ will mathematically diverge from $C_I$, and the TCB will reject it.
