//! EXPERIMENT 1 (as-measurable): timing side-channel resolution floor and
//! kernel allow/deny distinguishability.
//!
//! WHAT THIS REPLACES AND WHY
//! --------------------------
//! The original mandate was to assert that an allowed packet and an `-EPERM`
//! dropped packet differ by "within 2 clock cycles". That assertion is not
//! measurable from userspace, for two independent reasons this harness measures
//! directly rather than asserting:
//!
//!   (1) RESOLUTION. The hardware counter readable from EL0/ring-3 has a quantum.
//!       On aarch64 `cntvct_el0` runs at `cntfrq_el0` (24 MHz on Apple silicon),
//!       so one tick spans on the order of 100+ core cycles. A 2-cycle difference
//!       is *below the smallest number the instrument can express*. Stage 1
//!       measures that quantum instead of assuming it.
//!
//!   (2) ENCLOSURE. Any userspace measurement of a kernel policy decision brackets
//!       the syscall boundary and the network stack, not the policy check alone.
//!       That envelope costs thousands of cycles and its run-to-run dispersion is
//!       orders of magnitude larger than the decision it contains. Stage 2
//!       measures that dispersion.
//!
//! WHAT IT MEASURES INSTEAD
//! ------------------------
//! The security-relevant question is not "how many cycles apart are the paths"
//! but "can an adversary holding one timing observation tell which path ran".
//! That is an AUC (Mann-Whitney U normalised). AUC = 0.5 is indistinguishable;
//! AUC = 1.0 is a perfect oracle. This harness reports AUC with a p-value.
//!
//! NON-CLAIMS
//! ----------
//! * This does NOT measure an eBPF LSM program. eBPF/LSM is Linux-only and this
//!   repository contains no BPF loader; see the audit report. Stage 2 measures a
//!   kernel accept-vs-refuse decision on loopback TCP as a *stand-in* with the
//!   same structural shape (kernel-side allow/deny behind a syscall).
//! * A low AUC here is evidence of non-distinguishability *for this measurement
//!   setup and sample size only*. It does not prove the absence of a side channel,
//!   and it says nothing about an in-kernel adversary with better instruments.
//! * Nothing here establishes constant-time execution of any code.

use ghost_ark_experiments::stats::{self, Summary};
use ghost_ark_experiments::timebase;

use std::io::Read;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::time::Duration;

/// Nominal core clock used only to translate ticks into an *estimated* cycle
/// count for human readability. Reported as an estimate, never asserted on.
const ASSUMED_CORE_GHZ: f64 = 3.0;

fn main() {
    let samples = parse_samples_arg().unwrap_or(5_000);

    println!("=====================================================================");
    println!(" GHOST-ARK EXPERIMENT 1 — timing side-channel resolution floor");
    println!(" research-only harness; measures instruments, asserts only what holds");
    println!("=====================================================================");
    println!();
    println!("host arch      : {}", timebase::arch_name());
    println!("os             : {}", std::env::consts::OS);
    println!("samples/pop    : {}", samples);
    println!();

    let quantum_cycles = stage1_resolution();
    stage2_kernel_decision(samples);

    println!();
    println!("---------------------------------------------------------------------");
    println!(" VERDICT ON THE '2 CLOCK CYCLE' MANDATE");
    println!("---------------------------------------------------------------------");
    println!(
        " measured counter quantum : ~{:.1} estimated core cycles",
        quantum_cycles
    );
    println!(" mandated assertion bound : 2 core cycles");
    if quantum_cycles > 2.0 {
        println!(
            " RESULT: UNMEASURABLE. The instrument's smallest expressible difference\n\
             \x20        is ~{:.0}x the bound the mandate asks us to assert. A test asserting\n\
             \x20        a <=2-cycle delta on this host would not be measuring the delta;\n\
             \x20        it would be reporting counter quantisation.",
            quantum_cycles / 2.0
        );
    } else {
        println!(" RESULT: the counter quantum is at or below 2 cycles on this host.");
    }

    // The only assertion this harness makes is one it can actually support:
    // that the measured floor is real and non-zero.
    assert!(
        quantum_cycles > 0.0,
        "counter quantum must be positive; timebase is unusable on this host"
    );
}

fn parse_samples_arg() -> Option<usize> {
    std::env::args()
        .find_map(|a| a.strip_prefix("--samples=").map(str::to_owned))
        .and_then(|v| v.parse().ok())
}

/// Stage 1 — what is the smallest difference this host can express?
fn stage1_resolution() -> f64 {
    println!("---------------------------------------------------------------------");
    println!(" STAGE 1 — counter resolution (back-to-back reads, nothing between)");
    println!("---------------------------------------------------------------------");

    let arch_hz = timebase::architectural_hz();
    let cal_hz = timebase::calibrate_hz(Duration::from_millis(200));

    match arch_hz {
        Some(hz) => println!(" cntfrq_el0 (architectural) : {} Hz", hz),
        None => println!(" architectural rate         : not exposed to userspace on this arch"),
    }
    println!(" calibrated rate            : {:.0} Hz", cal_hz);

    let effective_hz = arch_hz.map(|h| h as f64).unwrap_or(cal_hz);
    let deltas = timebase::resolution_probe(200_000);
    let s = stats::summarize(&deltas);
    let zero_frac =
        deltas.iter().filter(|&&d| d == 0).count() as f64 / deltas.len() as f64 * 100.0;

    print_summary(" back-to-back read delta (ticks)", &s);
    println!(" reads returning an identical tick : {:.1}%", zero_frac);

    let quantum_ticks = stats::min_nonzero(&deltas).unwrap_or(1) as f64;
    let quantum_ns = quantum_ticks / effective_hz * 1e9;
    let quantum_cycles = quantum_ns * ASSUMED_CORE_GHZ;

    println!();
    println!(" counter quantum : {} tick(s)", quantum_ticks as u64);
    println!(
        " counter quantum : {:.2} ns  (~{:.0} core cycles at an assumed {:.1} GHz)",
        quantum_ns, quantum_cycles, ASSUMED_CORE_GHZ
    );
    if zero_frac > 1.0 {
        println!(
            " NOTE: {:.1}% of back-to-back reads returned the SAME tick. The counter\n\
             \x20      advances more slowly than this core retires instructions, so\n\
             \x20      sub-tick timing differences are not observable here at all.",
            zero_frac
        );
    }
    println!();

    quantum_cycles
}

/// Stage 2 — how distinguishable is a real kernel allow/deny decision?
fn stage2_kernel_decision(samples: usize) {
    println!("---------------------------------------------------------------------");
    println!(" STAGE 2 — kernel allow vs deny across the syscall boundary");
    println!("---------------------------------------------------------------------");
    println!(" stand-in for an LSM verdict: loopback TCP accept vs ECONNREFUSED");
    println!(" populations are INTERLEAVED to control for thermal/DVFS drift");
    println!();

    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .expect("bind accepting listener");
    let allowed_addr = match listener.local_addr().expect("local_addr") {
        SocketAddr::V4(a) => a,
        _ => unreachable!("bound to an IPv4 loopback address"),
    };

    // Drain the accept queue so the backlog never saturates; a saturated backlog
    // would change the kernel path under measurement partway through the run.
    let accept_thread = std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(mut s) => {
                    let _ = s.set_read_timeout(Some(Duration::from_millis(1)));
                    let mut buf = [0u8; 1];
                    let _ = s.read(&mut buf);
                    drop(s);
                }
                Err(_) => break,
            }
        }
    });

    // A port with nothing bound: the kernel answers RST -> ECONNREFUSED. This is
    // the closest userspace-observable analogue of a policy-driven rejection.
    let refused_addr = {
        let probe =
            TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("bind probe");
        let a = match probe.local_addr().expect("local_addr") {
            SocketAddr::V4(a) => a,
            _ => unreachable!("bound to an IPv4 loopback address"),
        };
        drop(probe);
        a
    };

    println!(" allowed target : {} (listening)", allowed_addr);
    println!(" denied  target : {} (no listener -> ECONNREFUSED)", refused_addr);
    println!();

    // Warm both paths before recording.
    for _ in 0..256 {
        let _ = timed_connect(allowed_addr);
        let _ = timed_connect(refused_addr);
    }

    let mut allowed = Vec::with_capacity(samples);
    let mut denied = Vec::with_capacity(samples);
    let mut allow_ok = 0usize;
    let mut deny_refused = 0usize;

    for i in 0..samples {
        // Alternate the order each iteration so neither population systematically
        // occupies the same position in the pair.
        if i % 2 == 0 {
            let (t, ok) = timed_connect(allowed_addr);
            allowed.push(t);
            allow_ok += ok as usize;
            let (t, ok) = timed_connect(refused_addr);
            denied.push(t);
            deny_refused += (!ok) as usize;
        } else {
            let (t, ok) = timed_connect(refused_addr);
            denied.push(t);
            deny_refused += (!ok) as usize;
            let (t, ok) = timed_connect(allowed_addr);
            allowed.push(t);
            allow_ok += ok as usize;
        }
    }

    println!(
        " sanity: {}/{} allowed connects succeeded, {}/{} denied connects refused",
        allow_ok,
        allowed.len(),
        deny_refused,
        denied.len()
    );
    if allow_ok * 20 < allowed.len() * 19 || deny_refused * 20 < denied.len() * 19 {
        println!(
            " WARNING: the two populations did not behave as intended (port reuse or\n\
             \x20         ephemeral-port exhaustion). Treat the statistics below as void."
        );
    }
    println!();

    let sa = stats::summarize(&allowed);
    let sd = stats::summarize(&denied);
    print_summary(" ALLOWED connect (ticks)", &sa);
    print_summary(" DENIED  connect (ticks)", &sd);

    let mw = stats::mann_whitney(&allowed, &denied);
    println!();
    println!(" Mann-Whitney U   : {:.0}", mw.u_statistic);
    println!(" z                : {:.2}", mw.z);
    println!(" p (two-sided)    : {:.3e}", mw.p_two_sided);
    println!(" AUC              : {:.4}   (0.5 = indistinguishable)", mw.auc);

    let advantage = (mw.auc - 0.5).abs() * 2.0;
    println!(" oracle advantage : {:.1}%", advantage * 100.0);
    println!();
    if advantage > 0.10 {
        println!(
            " FINDING: the allow and deny paths ARE distinguishable from a single\n\
             \x20         observation. A confined adversary can classify its own verdicts\n\
             \x20         by timing. Note this separation arises from the *kernel path\n\
             \x20         taken after the decision*, not from branch layout in any policy\n\
             \x20         program — which is precisely why branchless masking in an eBPF\n\
             \x20         source file does not close this channel."
        );
    } else {
        println!(
            " FINDING: no single-sample distinguisher was detected at this sample size.\n\
             \x20         This bounds the channel; it does not prove absence."
        );
    }

    drop(accept_thread);
}

fn timed_connect(addr: SocketAddrV4) -> (u64, bool) {
    let t0 = timebase::read_ticks();
    let r = TcpStream::connect(addr);
    let t1 = timebase::read_ticks();
    let ok = r.is_ok();
    drop(r);
    (t1.wrapping_sub(t0), ok)
}

fn print_summary(label: &str, s: &Summary) {
    println!(
        "{:<34} n={:<7} min={:<8} p01={:<8} med={:<8} p99={:<10} max={:<12} mad={}",
        label, s.n, s.min, s.p01, s.median, s.p99, s.max, s.mad
    );
}
