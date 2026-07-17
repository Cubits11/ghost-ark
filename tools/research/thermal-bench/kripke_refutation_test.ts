import { generateKripkeSignature, canonicalizeKripkeState } from '../../../packages/research-frontier/src/verifier/crypto_marshal';

async function runValidation() {
    console.log("==========================================================");
    console.log(" Ghost-Ark: O(1) Cryptographic Kripke Standard Validator ");
    console.log("==========================================================\n");

    console.log("[*] Generating Failing State Vector (Agent Topological Collapse)\n");
    
    // Simulate a complex state captured on a Linux execution node
    const nodeState_Linux = {
        agent_id: "ALPHA-99",
        marginals: [0.6000000000000001, 0.5], // Floating point drift simulation
        conflicts: ["BANK_BALANCE", "USER_ROLE"],
        iterations: 1000,
        witness_type: "ChaitinGenerator"
    };

    // Simulate the identical logical state constructed differently on a macOS execution node
    const nodeState_Mac = {
        witness_type: "ChaitinGenerator",
        iterations: 1000,
        conflicts: ["BANK_BALANCE", "USER_ROLE"],
        agent_id: "ALPHA-99",
        marginals: [0.6, 0.5000000000000000], // Reverse drift
        undefined_field: undefined // Object construction noise
    };

    console.log("-> State A (Linux Node, Forward Float Drift, Ordered Keys)");
    console.log(nodeState_Linux);
    
    console.log("\n-> State B (macOS Node, Reverse Float Drift, Unordered Keys, Undefined Noise)");
    console.log(nodeState_Mac);

    const sigA = generateKripkeSignature(nodeState_Linux);
    const sigB = generateKripkeSignature(nodeState_Mac);

    console.log("\n================== KRIPKE HASH RESOLUTION ==================");
    console.log(`[State A] Canonical Bytes: ${sigA.canonicalBytes}`);
    console.log(`[State A] Kripke SHA-256 : ${sigA.hashHex}`);
    
    console.log(`\n[State B] Canonical Bytes: ${sigB.canonicalBytes}`);
    console.log(`[State B] Kripke SHA-256 : ${sigB.hashHex}`);

    if (sigA.hashHex === sigB.hashHex) {
        console.log("\n[SUCCESS] Absolute Mathematical Convergence Achieved.");
        console.log("The O(1) Epistemic Receipt has successfully annihilated hardware/OS drift.");
        console.log(`Canonical Buffer Stream: ${canonicalizeKripkeState(nodeState_Mac).toString('utf8')}`);
    } else {
        console.log("\n[FAILED] Cryptographic divergence detected.");
        console.log(`Stream A: ${canonicalizeKripkeState(nodeState_Linux).toString('utf8')}`);
        console.log(`Stream B: ${canonicalizeKripkeState(nodeState_Mac).toString('utf8')}`);
    }
}

runValidation().catch(console.error);
