//! Selling: carts, discounts, coupons, tax, shipping cost, fee plugins and quotes.
//!
//! Shipping cost lives here (not in shop-fulfil) because pricing needs it and
//! orders need pricing; keeping it here avoids a crate cycle.

pub mod cart;
pub mod coupons;
pub mod discounts;
pub mod plugins;
pub mod pricing;
pub mod shipping;
pub mod tax;
