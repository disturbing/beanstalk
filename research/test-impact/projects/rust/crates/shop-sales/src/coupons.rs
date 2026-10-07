use shop_core::{Result, ShopError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CouponKind {
    Percent,
    Amount,
    Shipping,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coupon {
    pub kind: CouponKind,
    pub value: i64,
}

impl Coupon {
    pub fn new(kind: CouponKind, value: i64) -> Coupon {
        Coupon { kind, value }
    }
}

pub fn parse(code: &str) -> Result<Coupon> {
    let code = code.trim().to_uppercase();
    if let Some(rest) = code.strip_prefix("PCT") {
        return Ok(Coupon::new(CouponKind::Percent, number(rest, &code)?));
    }
    if let Some(rest) = code.strip_prefix("OFF") {
        return Ok(Coupon::new(CouponKind::Amount, number(rest, &code)? * 100));
    }
    if code == "FREESHIP" {
        return Ok(Coupon::new(CouponKind::Shipping, 0));
    }
    Err(ShopError::Value(format!("unknown coupon {code}")))
}

fn number(raw: &str, code: &str) -> Result<i64> {
    raw.parse().map_err(|_| ShopError::Value(format!("bad coupon {code}")))
}
