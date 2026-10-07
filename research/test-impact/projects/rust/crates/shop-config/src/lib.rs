//! App configuration from `config/app.toml` (loaded once, parsed by hand).

pub mod parse;

use std::collections::BTreeMap;
use std::sync::OnceLock;

pub use parse::Value;

pub fn load() -> &'static BTreeMap<String, Value> {
    static CONFIG: OnceLock<BTreeMap<String, Value>> = OnceLock::new();
    CONFIG.get_or_init(|| {
        let path = shop_core::paths::config().join("app.toml");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        parse::parse(&text)
    })
}

pub fn get(key: &str) -> Option<&'static Value> {
    load().get(key)
}

pub fn get_str(key: &str, default: &str) -> String {
    match get(key) {
        Some(Value::Str(s)) => s.clone(),
        Some(Value::Int(n)) => n.to_string(),
        _ => default.to_string(),
    }
}

pub fn get_int(key: &str, default: i64) -> i64 {
    match get(key) {
        Some(Value::Int(n)) => *n,
        _ => default,
    }
}

pub fn get_list(key: &str) -> Vec<String> {
    match get(key) {
        Some(Value::List(items)) => items.clone(),
        _ => Vec::new(),
    }
}
