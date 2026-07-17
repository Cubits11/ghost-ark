# Ghost-Ark Systems Architecture: Empirical Execution Boundaries

**Target Profile**: OS-Level Systems Security & Systems Architecture.
This document strips all pseudo-physics abstractions and grounds Ghost-Ark into strict POSIX, kernel, and systems engineering realities.

## 1. Memory Strict-Bounding (cgroups v2 & prlimit)
*Replacing the concept of Holographic Space*

**The Engineering Reality:** 
Adversarial algorithms (e.g., recursive Chaitin density loops) exhaust memory, causing system-wide Out-Of-Memory (OOM) cascading failures. V8 memory limit checks (`getHeapStatistics`) are merely user-space suggestions. True strict bounding is enforced at the kernel layer using **Linux cgroups v2**.

**Implementation Blueprint:**
Before an autonomous agent process is executed, Ghost-Ark constructs an isolated memory namespace:
```bash
# Instantiate cgroup v2 for agent containment
mkdir -p /sys/fs/cgroup/ghost_ark_agent_alpha
# Enforce a strict 50MB physical RAM limit
echo 52428800 > /sys/fs/cgroup/ghost_ark_agent_alpha/memory.max
# Disable swap to prevent I/O disk thrashing during recursive density attacks
echo 0 > /sys/fs/cgroup/ghost_ark_agent_alpha/memory.swap.max
# Assign the PID
echo $AGENT_PID > /sys/fs/cgroup/ghost_ark_agent_alpha/cgroup.procs
```
When an adversarial LLM payload exceeds `memory.max`, the Linux kernel's OOM killer instantly sends a `SIGKILL`, annihilating the process at Ring-0.

## 2. Pre-Execution Logical Bounding (Wasm Sandbox)
*Replacing the concept of Photonic Logic Gates*

**The Engineering Reality:** 
Semantic safety checks cannot be evaluated by another LLM; that generates $O(n)$ latency. We use WebAssembly (Wasm). LLM policy guidelines are pre-compiled into boolean matrices executing inside `wasmtime` or `v8-isolate`.

**Implementation Blueprint:**
The agent's intent vector is passed to a Wasm binary mapping constraints $Ax \le b$. Wasm provides hardware-level sandboxing (linear memory bounds) and executes the validation in under 100 microseconds. If the dot product exceeds the memory threshold, the Wasm module traps, avoiding host state mutation entirely.

## 3. eBPF & Seccomp Trace Blocking
*Replacing the concept of Quantum Zeno Freeze*

**The Engineering Reality:** 
Continuous observation of an unaligned system is a kernel-level tracing issue. An autonomous agent process must be born into a straightjacket. We use `seccomp-bpf` (Secure Computing Mode).

**Implementation Blueprint:**
The agent process is restricted via a strict Berkeley Packet Filter (BPF) profile loaded upon execution:
```c
// Seccomp BPF struct (Conceptual)
struct sock_filter filter[] = {
    // Validate Architecture
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (offsetof(struct seccomp_data, arch))),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    // Allow read, write, exit
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (offsetof(struct seccomp_data, nr))),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_read, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    // Block execve (Prevents RCE/jailbreaks from spawning reverse shells)
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_execve, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
};
```
If an adversarial LLM constructs a payload that tricks the interpreter into issuing a reverse shell (`execve`), the kernel executes `SECCOMP_RET_KILL_PROCESS`. The agent dies in 0 nanoseconds.

## 4. Cryptographic Event-Sourced Rollbacks
*Replacing the concept of Reversible Fredkin Gates*

**The Engineering Reality:** 
You cannot un-compute the universe. However, utilizing a strict **CQRS / Event-Sourcing pattern**, the current canonical state is merely a left-fold over a cryptographically linked append-only log. When a `Kripke Refutation Witness` flags a trajectory as poisoned, we do not issue a database `DELETE`. We issue a **Compensating Reversal Transaction**, recalculating the prior state and appending it to the Merkle tree. History is immutable; malice is simply undone algebraically.

## 5. BFT Consensus
*Replacing the concept of Non-Local Quantum Entanglement*

**The Engineering Reality:** 
There is no "spooky action at a distance." Network latency relies on fiber-optic topologies bounding $c$. To prevent split-brain state mutations among global LLM clusters, Ghost-Ark relies on strict Byzantine Fault Tolerant (BFT) implementations (e.g., Raft). Mutating the canonical state map strictly requires a $2/3$ quorum of cryptographically signed TCP payload agreements.
