/** The library has no Worker of its own; the test pool needs an entry module. */
// oxlint-disable-next-line import/no-default-export -- a Worker entry module must default-export its handler
export default {
  fetch(): Response {
    return new Response('shared-identity test worker', { status: 404 });
  },
};
