use std::fmt;
use std::ops::{Add, Sub};

use crate::{Result, ShopError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Money {
    pub cents: i64,
    pub currency: String,
}

impl Money {
    /// USD amount, matching the Python default currency.
    pub fn new(cents: i64) -> Money {
        Money::of(cents, "USD")
    }

    pub fn of(cents: i64, currency: &str) -> Money {
        Money { cents, currency: currency.to_string() }
    }

    pub fn try_add(&self, other: &Money) -> Result<Money> {
        same(self, other)?;
        Ok(Money::of(self.cents + other.cents, &self.currency))
    }

    pub fn try_sub(&self, other: &Money) -> Result<Money> {
        same(self, other)?;
        Ok(Money::of(self.cents - other.cents, &self.currency))
    }

    pub fn times(&self, qty: i64) -> Money {
        Money::of(self.cents * qty, &self.currency)
    }

    pub fn pct(&self, rate: f64) -> Money {
        Money::of(round_half_up(self.cents as f64 * rate), &self.currency)
    }

    pub fn format(&self) -> String {
        let sign = if self.cents < 0 { "-" } else { "" };
        let abs = self.cents.abs();
        format!("{sign}{}.{:02} {}", abs / 100, abs % 100, self.currency)
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.format())
    }
}

/// Panics on currency mismatch; use `try_add` for a recoverable error.
impl Add for Money {
    type Output = Money;
    fn add(self, other: Money) -> Money {
        self.try_add(&other).unwrap_or_else(|e| panic!("{e}"))
    }
}

/// Panics on currency mismatch; use `try_sub` for a recoverable error.
impl Sub for Money {
    type Output = Money;
    fn sub(self, other: Money) -> Money {
        self.try_sub(&other).unwrap_or_else(|e| panic!("{e}"))
    }
}

pub fn round_half_up(x: f64) -> i64 {
    if x >= 0.0 {
        (x + 0.5) as i64
    } else {
        -((-x + 0.5) as i64)
    }
}

pub fn zero(currency: &str) -> Money {
    Money::of(0, currency)
}

pub fn zero_usd() -> Money {
    zero("USD")
}

fn same(a: &Money, b: &Money) -> Result<()> {
    if a.currency != b.currency {
        return Err(ShopError::Value(format!("currency mismatch {} != {}", a.currency, b.currency)));
    }
    Ok(())
}
