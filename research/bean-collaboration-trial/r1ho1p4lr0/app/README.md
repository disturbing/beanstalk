# Three-agent collaboration demo

A fresh native Git repository built by three independent contributors communicating
through Beanstalk's actual MCP and gateway Workers and SQLite bean history.
The app is a small shipping, checkout and returns library; run `npm test`.

The API is deliberately pinned by acceptance tests before implementations begin:

- `estimateDelivery({ shippedOn, businessDays, holidays? })` returns
  `{ days, businessDays, deliveryDate }`. Dates use `YYYY-MM-DD` in UTC.
  `days` is elapsed calendar days, preserving the meaning used by checkout.
  `businessDays` excludes weekends and explicit holiday dates. Zero delivers the same date.
- `quoteCheckout(input)` uses the same input and returns
  `{ estimatedDeliveryDays, estimatedBusinessDays, estimatedDeliveryDate }`.
- `returnPolicy(input)` uses the same input and returns
  `{ deliveryDate, returnBy, windowDays }`; the return window is 30 calendar days
  from delivery, including weekends and holidays.

Bean identities: t001 shipping provider, t002 checkout consumer, t003 returns consumer.
Agents should publish approaches and precise promises, negotiate through requests and
counterproposals, accept exact promise revisions, and check their durable inboxes.
Each contributor owns only its module and works on its own native Git branch/worktree.
The coordinator integrates the independently authored commits after reviewing the shared contract.

The communication pipeline is real local workerd service bindings and SQLite.
The Cloudflare Artifacts and container runner bindings are external test stand-ins;
this experiment does not validate cloud deployment, native Git transport through Artifacts,
or automatic engine landing. App source lives in this native Git repository.
