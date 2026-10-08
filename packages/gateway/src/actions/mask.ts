/**
 * Log masking (doc 25 §3.3): every secret value a job may read, its base64 and URL-encoded
 * forms, and the job token, become `***` in every line before it is relayed or stored. The
 * executor masks too; this is the control plane's own guarantee.
 */

const MASK = '***';
/** Values shorter than this are not masked (they would mask ordinary text, as on GitHub). */
const MIN_MASKED = 3;

/** The strings to mask for these values, longest first. */
export function maskTermsOf(values: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    if (value.length < MIN_MASKED) continue;
    terms.add(value);
    terms.add(btoa(String.fromCharCode(...new TextEncoder().encode(value))));
    terms.add(encodeURIComponent(value));
    for (const line of value.split('\n'))
      if (line.trim().length >= MIN_MASKED) terms.add(line.trim());
  }
  return [...terms].toSorted((a, b) => b.length - a.length);
}

export function maskText(text: string, terms: readonly string[]): string {
  let masked = text;
  for (const term of terms) masked = masked.replaceAll(term, MASK);
  return masked;
}
