use shop_core::{Result, ShopError};

/// Matches `^SKU-\d{3}$`.
pub fn is_sku(value: &str) -> bool {
    match value.strip_prefix("SKU-") {
        Some(rest) => rest.len() == 3 && rest.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

/// Matches `^[^@\s]+@[^@\s]+\.[a-z]{2,}$`.
pub fn is_email(value: &str) -> bool {
    if value.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    if local.is_empty() || domain.contains('@') {
        return false;
    }
    let Some((host, tld)) = domain.rsplit_once('.') else {
        return false;
    };
    !host.is_empty() && tld.len() >= 2 && tld.bytes().all(|b| b.is_ascii_lowercase())
}

pub fn require(cond: bool, message: &str) -> Result<()> {
    if cond {
        Ok(())
    } else {
        Err(ShopError::Value(message.to_string()))
    }
}
