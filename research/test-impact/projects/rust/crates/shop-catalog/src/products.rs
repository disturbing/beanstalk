use std::collections::HashMap;
use std::sync::OnceLock;

use shop_core::money::Money;
use shop_core::{paths, Result, ShopError};
use shop_util::validation::{is_sku, require};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Product {
    pub sku: String,
    pub name: String,
    pub price: Money,
    pub weight_g: i64,
    pub category: String,
}

pub fn catalog() -> &'static HashMap<String, Product> {
    static CATALOG: OnceLock<HashMap<String, Product>> = OnceLock::new();
    CATALOG.get_or_init(|| load().unwrap_or_else(|e| panic!("catalog: {e}")))
}

fn load() -> Result<HashMap<String, Product>> {
    let path = paths::data().join("catalog.csv");
    let text = std::fs::read_to_string(&path).map_err(|e| ShopError::Value(format!("read {}: {e}", path.display())))?;
    let mut out = HashMap::new();
    for line in text.lines().skip(1).filter(|l| !l.trim().is_empty()) {
        let cols: Vec<&str> = line.split(',').map(str::trim).collect();
        require(cols.len() == 5, &format!("bad catalog row {line}"))?;
        require(is_sku(cols[0]), &format!("bad sku {}", cols[0]))?;
        let product = Product {
            sku: cols[0].to_string(),
            name: cols[1].to_string(),
            price: Money::new(int(cols[2])?),
            weight_g: int(cols[3])?,
            category: cols[4].to_string(),
        };
        out.insert(product.sku.clone(), product);
    }
    Ok(out)
}

fn int(raw: &str) -> Result<i64> {
    raw.parse().map_err(|_| ShopError::Value(format!("not an integer: {raw}")))
}

pub fn find(sku: &str) -> Result<&'static Product> {
    catalog().get(sku).ok_or_else(|| ShopError::Key(format!("no product {sku}")))
}

pub fn by_category(category: &str) -> Vec<&'static Product> {
    let mut out: Vec<&Product> = catalog().values().filter(|p| p.category == category).collect();
    out.sort_by(|a, b| a.sku.cmp(&b.sku));
    out
}
