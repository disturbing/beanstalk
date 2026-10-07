//! Loads `fixtures/orders.txt`: one order per line, `sku:qty,sku:qty coupon` (`-` = no coupon).

use std::path::PathBuf;

use shop_sales::cart::Cart;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureOrder {
    pub lines: Vec<(String, i64)>,
    pub coupon: Option<String>,
}

impl FixtureOrder {
    pub fn cart(&self) -> Cart {
        let lines: Vec<(&str, i64)> = self.lines.iter().map(|(s, q)| (s.as_str(), *q)).collect();
        crate::factories::cart_of(&lines)
    }

    pub fn coupon(&self) -> Option<&str> {
        self.coupon.as_deref()
    }
}

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

pub fn fixture_orders() -> Vec<FixtureOrder> {
    let path = fixtures_dir().join("orders.txt");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(parse_line).collect()
}

fn parse_line(line: &str) -> FixtureOrder {
    let (items, coupon) = line.split_once(char::is_whitespace).unwrap_or((line, "-"));
    let lines = items
        .split(',')
        .map(|item| {
            let (sku, qty) = item.split_once(':').expect("fixture line item needs sku:qty");
            (sku.to_string(), qty.parse().expect("fixture qty"))
        })
        .collect();
    let coupon = match coupon.trim() {
        "-" => None,
        c => Some(c.to_string()),
    };
    FixtureOrder { lines, coupon }
}
