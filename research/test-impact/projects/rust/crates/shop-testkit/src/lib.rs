//! Dev-only helpers shared by integration tests: factories and fixture loading.

pub mod factories;
pub mod fixtures;

pub use factories::{cart_of, stocked};
pub use fixtures::{fixture_orders, FixtureOrder};
