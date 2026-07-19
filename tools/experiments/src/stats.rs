//! Distribution-free statistics for timing side-channel measurement.
//!
//! WHY RANK STATISTICS AND NOT A MEAN DELTA
//! ----------------------------------------
//! Timing samples taken across a syscall boundary are heavy-tailed and not
//! normally distributed: interrupts, scheduler migration, frequency transitions
//! and cache state produce large outliers in one direction only. A mean or a
//! "delta in cycles" is dominated by those outliers and is not a meaningful
//! statement about distinguishability.
//!
//! The question that actually matters for a timing side channel is: *given one
//! observation, with what probability can an adversary tell which population it
//! came from?* That is exactly the Mann-Whitney U statistic normalised to an AUC
//! (equivalently, the common-language effect size). AUC = 0.5 means the two
//! populations are indistinguishable to a single-sample distinguisher; AUC = 1.0
//! means a perfect oracle.

#[derive(Debug, Clone)]
pub struct Summary {
    pub n: usize,
    pub min: u64,
    pub p01: u64,
    pub median: u64,
    pub p99: u64,
    pub max: u64,
    /// Median absolute deviation — a robust dispersion measure that, unlike the
    /// standard deviation, is not destroyed by the heavy right tail.
    pub mad: u64,
}

pub fn summarize(samples: &[u64]) -> Summary {
    assert!(!samples.is_empty(), "cannot summarize an empty sample");
    let mut s = samples.to_vec();
    s.sort_unstable();
    let median = percentile_sorted(&s, 0.50);
    let mut devs: Vec<u64> = s
        .iter()
        .map(|&v| if v > median { v - median } else { median - v })
        .collect();
    devs.sort_unstable();
    Summary {
        n: s.len(),
        min: s[0],
        p01: percentile_sorted(&s, 0.01),
        median,
        p99: percentile_sorted(&s, 0.99),
        max: s[s.len() - 1],
        mad: percentile_sorted(&devs, 0.50),
    }
}

/// Nearest-rank percentile over an already-sorted slice.
pub fn percentile_sorted(sorted: &[u64], q: f64) -> u64 {
    assert!(!sorted.is_empty());
    let idx = ((q * sorted.len() as f64).ceil() as usize).saturating_sub(1);
    sorted[idx.min(sorted.len() - 1)]
}

/// Smallest strictly-positive value in the sample, if any.
///
/// For a counter-resolution probe this is the counter quantum: the smallest
/// difference the hardware can express on this host.
pub fn min_nonzero(samples: &[u64]) -> Option<u64> {
    samples.iter().copied().filter(|&v| v > 0).min()
}

#[derive(Debug, Clone)]
pub struct MannWhitney {
    /// P(a random sample from `a` > a random sample from `b`), ties counted as ½.
    /// 0.5 == indistinguishable.
    pub auc: f64,
    pub u_statistic: f64,
    pub z: f64,
    pub p_two_sided: f64,
    pub n_a: usize,
    pub n_b: usize,
}

/// Tie-corrected Mann-Whitney U with a normal approximation.
///
/// The normal approximation is appropriate here because both samples are large
/// (thousands of observations); it is not valid for small n.
pub fn mann_whitney(a: &[u64], b: &[u64]) -> MannWhitney {
    let n_a = a.len();
    let n_b = b.len();
    assert!(n_a > 0 && n_b > 0, "both samples must be non-empty");

    // Pool and rank with average ranks for ties.
    let mut pooled: Vec<(u64, bool)> = Vec::with_capacity(n_a + n_b);
    pooled.extend(a.iter().map(|&v| (v, true)));
    pooled.extend(b.iter().map(|&v| (v, false)));
    pooled.sort_unstable_by_key(|&(v, _)| v);

    let n = pooled.len();
    let mut rank_sum_a = 0.0f64;
    let mut tie_correction = 0.0f64;

    let mut i = 0usize;
    while i < n {
        let mut j = i;
        while j + 1 < n && pooled[j + 1].0 == pooled[i].0 {
            j += 1;
        }
        let group = (j - i + 1) as f64;
        // Average of ranks (i+1 ..= j+1), 1-indexed.
        let avg_rank = ((i + 1) as f64 + (j + 1) as f64) / 2.0;
        for k in i..=j {
            if pooled[k].1 {
                rank_sum_a += avg_rank;
            }
        }
        tie_correction += group * group * group - group;
        i = j + 1;
    }

    let na = n_a as f64;
    let nb = n_b as f64;
    let nn = n as f64;

    let u_a = rank_sum_a - na * (na + 1.0) / 2.0;
    let mu = na * nb / 2.0;
    let var = (na * nb / 12.0) * ((nn + 1.0) - tie_correction / (nn * (nn - 1.0)));
    let sigma = var.max(f64::MIN_POSITIVE).sqrt();
    let z = (u_a - mu) / sigma;

    MannWhitney {
        auc: u_a / (na * nb),
        u_statistic: u_a,
        z,
        p_two_sided: 2.0 * (1.0 - normal_cdf(z.abs())),
        n_a,
        n_b,
    }
}

/// Standard normal CDF via the Abramowitz & Stegun 7.1.26 error-function
/// approximation (absolute error < 1.5e-7).
pub fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

fn erf(x: f64) -> f64 {
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let y = 1.0
        - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
            + 0.254829592)
            * t
            * (-x * x).exp();
    sign * y
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_populations_give_auc_one_half() {
        let a: Vec<u64> = (0..500).map(|i| i % 50).collect();
        let b: Vec<u64> = (0..500).map(|i| i % 50).collect();
        let mw = mann_whitney(&a, &b);
        assert!(
            (mw.auc - 0.5).abs() < 1e-9,
            "identical populations must be indistinguishable, got AUC {}",
            mw.auc
        );
    }

    #[test]
    fn fully_separated_populations_give_auc_one() {
        let a: Vec<u64> = (1000..1500).collect();
        let b: Vec<u64> = (0..500).collect();
        let mw = mann_whitney(&a, &b);
        assert!(
            (mw.auc - 1.0).abs() < 1e-9,
            "disjoint populations must be a perfect oracle, got AUC {}",
            mw.auc
        );
    }

    #[test]
    fn median_and_mad_are_robust_to_outliers() {
        let mut v: Vec<u64> = vec![10; 999];
        v.push(1_000_000);
        let s = summarize(&v);
        assert_eq!(s.median, 10);
        assert_eq!(s.mad, 0);
        assert_eq!(s.max, 1_000_000);
    }

    #[test]
    fn min_nonzero_skips_zero_quanta() {
        assert_eq!(min_nonzero(&[0, 0, 0, 7, 12]), Some(7));
        assert_eq!(min_nonzero(&[0, 0]), None);
    }
}
