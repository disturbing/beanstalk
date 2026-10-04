export interface User {
  id: string;
  name?: string;
  email: string;
}

/** Name shown in the header and on invoices. */
export function displayName(user: User): string {
  return user.name ?? "";
}
