//! A tiny `key = value` parser: quoted strings, integers and `["a", "b"]` lists.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Str(String),
    Int(i64),
    List(Vec<String>),
}

pub fn parse(text: &str) -> BTreeMap<String, Value> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), parse_value(v.trim())))
        .collect()
}

fn parse_value(raw: &str) -> Value {
    if let Some(inner) = raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
        let items = inner.split(',').map(unquote).filter(|s| !s.is_empty()).collect();
        return Value::List(items);
    }
    if raw.starts_with('"') {
        return Value::Str(unquote(raw));
    }
    match raw.parse::<i64>() {
        Ok(n) => Value::Int(n),
        Err(_) => Value::Str(raw.to_string()),
    }
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    s.strip_prefix('"').and_then(|r| r.strip_suffix('"')).unwrap_or(s).to_string()
}
