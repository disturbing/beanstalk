//! Structured JSON logs on stdout (Workers Logs reads one object per line).

use tracing_subscriber::EnvFilter;

/// Installs the JSON subscriber, filtered by `RUST_LOG` (default `info`). A second call keeps the
/// first subscriber.
pub fn init() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let installed = tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_current_span(true)
        .with_span_list(false)
        .try_init();
    // Err only means a subscriber already exists (tests initialise more than once).
    drop(installed);
}
