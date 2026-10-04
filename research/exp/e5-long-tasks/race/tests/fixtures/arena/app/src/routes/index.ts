export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: () => unknown;
}

export const routes: Route[] = [
  { method: "GET", path: "/cart", handler: () => ({ items: [] }) },
  { method: "POST", path: "/checkout", handler: () => ({ ok: true }) },
];

export function findRoute(method: string, path: string): Route | undefined {
  return routes.find((r) => r.method === method && r.path === path);
}
