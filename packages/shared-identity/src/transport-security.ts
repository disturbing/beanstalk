/**
 * HTTP Strict Transport Security for the public hosts (api., mcp.): a browser that has seen
 * one https answer never tries plain http on the domain again for a year.
 */

export const HSTS_VALUE = 'max-age=31536000; includeSubDomains';

/**
 * `response` with `Strict-Transport-Security` when `request` came over https. A WebSocket
 * upgrade and a plain http request pass through unchanged (the header only counts over https).
 */
export function withHsts(request: Request, response: Response): Response {
  if (new URL(request.url).protocol !== 'https:' || response.webSocket !== null) return response;
  const secured = new Response(response.body, response);
  secured.headers.set('strict-transport-security', HSTS_VALUE);
  return secured;
}
