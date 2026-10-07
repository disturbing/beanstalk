use std::collections::HashMap;

use shop_core::{Result, ShopError};

#[derive(Debug, Clone, Default)]
pub struct Inventory {
    pub levels: HashMap<String, i64>,
    pub reserved: HashMap<String, i64>,
}

impl Inventory {
    pub fn new(levels: &[(&str, i64)]) -> Inventory {
        Inventory {
            levels: levels.iter().map(|(sku, n)| (sku.to_string(), *n)).collect(),
            reserved: HashMap::new(),
        }
    }

    pub fn available(&self, sku: &str) -> i64 {
        self.levels.get(sku).copied().unwrap_or(0) - self.reserved.get(sku).copied().unwrap_or(0)
    }

    pub fn reserve(&mut self, sku: &str, qty: i64) -> Result<()> {
        if qty <= 0 {
            return Err(ShopError::Value("qty must be positive".into()));
        }
        if self.available(sku) < qty {
            return Err(ShopError::OutOfStock(sku.to_string()));
        }
        *self.reserved.entry(sku.to_string()).or_insert(0) += qty;
        Ok(())
    }

    pub fn release(&mut self, sku: &str, qty: i64) {
        let held = self.reserved.get(sku).copied().unwrap_or(0);
        self.reserved.insert(sku.to_string(), (held - qty).max(0));
    }

    pub fn commit(&mut self, sku: &str, qty: i64) {
        self.release(sku, qty);
        *self.levels.entry(sku.to_string()).or_insert(0) -= qty;
    }
}
