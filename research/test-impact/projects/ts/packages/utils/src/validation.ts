const SKU_RE = /^SKU-\d{3}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;

export function isSku(value: string): boolean {
  return SKU_RE.test(value);
}

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function requireThat(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
