use std::collections::BTreeMap;

use shop_catalog::products::{find, Product};
use shop_core::money::{zero_usd, Money};
use shop_core::{Result, ShopError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub product: Product,
    pub qty: i64,
}

impl Line {
    pub fn total(&self) -> Money {
        self.product.price.times(self.qty)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cart {
    pub lines: BTreeMap<String, Line>,
}

impl Cart {
    pub fn new() -> Cart {
        Cart::default()
    }

    pub fn add(&mut self, sku: &str, qty: i64) -> Result<()> {
        if qty <= 0 {
            return Err(ShopError::Value("qty must be positive".into()));
        }
        if let Some(line) = self.lines.get_mut(sku) {
            line.qty += qty;
        } else {
            self.lines.insert(sku.to_string(), Line { product: find(sku)?.clone(), qty });
        }
        Ok(())
    }

    pub fn remove(&mut self, sku: &str) {
        self.lines.remove(sku);
    }

    pub fn subtotal(&self) -> Money {
        self.lines.values().fold(zero_usd(), |total, line| total + line.total())
    }

    pub fn weight_g(&self) -> i64 {
        self.lines.values().map(|l| l.product.weight_g * l.qty).sum()
    }

    pub fn count(&self) -> i64 {
        self.lines.values().map(|l| l.qty).sum()
    }
}
