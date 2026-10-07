export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function padRight(text: string, width: number): string {
  return text.slice(0, width).padEnd(width);
}

export function padLeft(text: string, width: number): string {
  return text.slice(0, width).padStart(width);
}
