//! Portable hardware timebase reader.
//!
//! SCOPE / NON-CLAIM
//! ----------------
//! This module reads the closest thing each supported architecture offers to a
//! free-running hardware counter. It does **not** provide "CPU cycle" accounting:
//!
//!   * x86_64 `rdtsc` counts at the invariant TSC rate, which on modern parts is
//!     decoupled from the core clock (it does not scale with DVFS/turbo). A "TSC
//!     tick" is therefore not a core clock cycle.
//!   * aarch64 `cntvct_el0` is a fixed-frequency system counter. On Apple silicon
//!     `cntfrq_el0` reports 24 MHz, so a single tick spans on the order of a
//!     hundred core cycles. Sub-tick resolution does not exist.
//!
//! Any statement about "clock cycles" derived from these counters is an estimate
//! obtained by multiplying ticks by a calibrated tick/second rate. The counter
//! quantum, reported by `resolution_probe`, is the hard floor on what can be
//! resolved on a given host.

/// One observation of the hardware counter.
pub type Ticks = u64;

#[cfg(target_arch = "x86_64")]
#[inline(always)]
pub fn read_ticks() -> Ticks {
    // lfence on both sides bounds the instruction window the counter read can be
    // reordered across. This is the conventional serialization for rdtsc; it is a
    // fence, not a guarantee of exact attribution.
    unsafe {
        core::arch::x86_64::_mm_lfence();
        let t = core::arch::x86_64::_rdtsc();
        core::arch::x86_64::_mm_lfence();
        t
    }
}

#[cfg(target_arch = "aarch64")]
#[inline(always)]
pub fn read_ticks() -> Ticks {
    let t: u64;
    unsafe {
        // `isb` prevents the counter read from being speculated ahead of prior
        // instructions. `cntvct_el0` is readable from EL0 when CNTKCTL_EL1.EL0VCTEN
        // is set, which is the default on Linux and Darwin.
        core::arch::asm!(
            "isb",
            "mrs {t}, cntvct_el0",
            t = out(reg) t,
            options(nostack)
        );
    }
    t
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
#[inline(always)]
pub fn read_ticks() -> Ticks {
    compile_error!("ghost-ark-experiments supports x86_64 and aarch64 only");
}

/// Architectural counter frequency, when the hardware exposes it directly.
///
/// aarch64 publishes this in `cntfrq_el0`. x86_64 has no architectural way to read
/// the TSC rate from userspace, so this returns `None` there and callers must fall
/// back to [`calibrate_hz`].
#[cfg(target_arch = "aarch64")]
pub fn architectural_hz() -> Option<u64> {
    let f: u64;
    unsafe {
        core::arch::asm!("mrs {f}, cntfrq_el0", f = out(reg) f, options(nomem, nostack));
    }
    if f == 0 {
        None
    } else {
        Some(f)
    }
}

#[cfg(target_arch = "x86_64")]
pub fn architectural_hz() -> Option<u64> {
    None
}

/// Empirically calibrate ticks/second against the OS monotonic clock.
///
/// This is a cross-check on [`architectural_hz`], and the only available rate on
/// x86_64. It is itself approximate: it inherits any error in `Instant`.
pub fn calibrate_hz(sample_window: std::time::Duration) -> f64 {
    let t0 = read_ticks();
    let w0 = std::time::Instant::now();
    while w0.elapsed() < sample_window {
        core::hint::spin_loop();
    }
    let elapsed = w0.elapsed();
    let t1 = read_ticks();
    (t1.wrapping_sub(t0)) as f64 / elapsed.as_secs_f64()
}

/// Measure the counter's own quantum and read cost.
///
/// Returns the sorted set of non-zero deltas observed between back-to-back reads
/// with nothing in between. The minimum non-zero delta is the counter's effective
/// resolution: no experiment on this host can resolve a difference smaller than it.
pub fn resolution_probe(samples: usize) -> Vec<u64> {
    let mut deltas = Vec::with_capacity(samples);
    // Warm the loop so we measure steady state rather than first-touch effects.
    for _ in 0..1024 {
        let a = read_ticks();
        let b = read_ticks();
        core::hint::black_box(b.wrapping_sub(a));
    }
    for _ in 0..samples {
        let a = read_ticks();
        let b = read_ticks();
        deltas.push(b.wrapping_sub(a));
    }
    deltas
}

pub fn arch_name() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64 (rdtsc, invariant TSC)"
    } else {
        "aarch64 (cntvct_el0, fixed-frequency system counter)"
    }
}
