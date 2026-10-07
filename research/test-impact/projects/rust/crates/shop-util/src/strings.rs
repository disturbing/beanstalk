/// Lowercase, collapse every run of non `[a-z0-9]` chars to `-`, trim dashes.
pub fn slugify(text: &str) -> String {
    let mut out = String::new();
    let mut in_gap = false;
    for ch in text.to_lowercase().chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            out.push(ch);
            in_gap = false;
        } else if !in_gap {
            out.push('-');
            in_gap = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// Truncate to `width` chars, then pad with spaces on the right.
pub fn pad_right(text: &str, width: usize) -> String {
    let cut: String = text.chars().take(width).collect();
    format!("{cut:<width$}")
}

/// Truncate to `width` chars, then pad with spaces on the left.
pub fn pad_left(text: &str, width: usize) -> String {
    let cut: String = text.chars().take(width).collect();
    format!("{cut:>width$}")
}
