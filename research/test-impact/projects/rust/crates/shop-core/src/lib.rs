//! Core value types for the shop: money, currency conversion, ids, paths and the shared error.

pub mod currency;
pub mod ids;
pub mod money;
pub mod paths;

use std::fmt;

/// The shop's error kinds, mirroring the Python exceptions (ValueError, KeyError, OutOfStock).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShopError {
    Value(String),
    Key(String),
    OutOfStock(String),
}

impl fmt::Display for ShopError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ShopError::Value(m) => write!(f, "value error: {m}"),
            ShopError::Key(m) => write!(f, "key error: {m}"),
            ShopError::OutOfStock(sku) => write!(f, "out of stock: {sku}"),
        }
    }
}

impl std::error::Error for ShopError {}

pub type Result<T> = std::result::Result<T, ShopError>;
