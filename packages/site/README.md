# @gitstalk/site

The Gitstalk marketing site and public documentation: plain HTML, CSS and a little JavaScript
in `public/`, served as Workers static assets by the Worker `gitstalk-site` (no Worker script,
no bindings). On the hosted service the site shares the web app's origin (https://gitstalk.io):
an environment whose site URL equals its web URL gives `gitstalk-web` a `SITE` service binding,
and the web Worker forwards the site's paths (`/docs`, root `.html` pages and assets, and `/`
for visitors who are signed out). Elsewhere, such as a workers.dev stack or local dev, the site
runs on its own address.

```
browser ──▶ gitstalk-web ──SITE──▶ gitstalk-site (public/)    same origin, hosted service
browser ──────────────────────────▶ gitstalk-site (public/)    its own address otherwise
```

## Contents

| Path | Contents |
|---|---|
| `public/index.html`, `agent.html`, `human.html`, `about.html` | Landing and audience pages, with their scripted demos (`app-demo.js`, `automations-demo.js`, `mq-section.js`, `site.js`) |
| `public/privacy.html`, `terms.html`, `404.html` | Legal pages and the not-found page |
| `public/docs/` | Public docs, one page per topic (`index.html` overview, `repositories`, `git`, `agents`, `checks`, `collaborators`, `decisions`, `streaming-diffs`, `actions`, `automations`, `self-hosting`, `architecture`, `research`), styled by `docs.css` |
| `public/site.css`, `favicon.svg`, `og-image.png` | Shared styles, icon and social card |
| `public/_headers`, `robots.txt` | `X-Robots-Tag: noindex` for the site on its own address; on the web's origin the web Worker answers `robots.txt` and indexing instead |
| `social/og-image.html` | Source of the social card; re-render instructions are in the file (the PNG is copied to `public/` here and in `packages/web/public/`) |
| `shots/` | Screenshots of the site's sections (not served) |

`wrangler.jsonc` serves `public/` with `html_handling: "auto-trailing-slash"` (so `/docs/git`
resolves to `docs/git.html`) and `not_found_handling: "404-page"`.

## Develop

```bash
pnpm -F @gitstalk/site dev --port 8790    # wrangler dev; the web app's DOCS_URL points at :8790/docs/
pnpm -F @gitstalk/site test               # node ../../scripts/check-docs.mjs
```

There is no build step: edit the files in `public/` and reload. Local dev works offline.

The test is [`scripts/check-docs.mjs`](../../scripts/check-docs.mjs) (also run by `pnpm check`).
It fails when an internal link is not a root-absolute clean URL (`/docs/git`, never `git.html`),
when a link or `#id` does not resolve, when a docs page's left nav differs from the overview's
list, or when a page lacks its title, description, Open Graph text or social card.

## Keeping the docs true

The docs describe the hosted service, so they change with the product:

- The [`public-docs` skill](../../.agents/skills/public-docs/SKILL.md) says which page covers
  what, how the `live`, `rolling out` and `coming soon` labels are set (by what is deployed,
  never by what is merged), the number style and the shared nav.
- In Claude Code, the [`docs-maintainer`](../../.claude/agents/docs-maintainer.md) agent
  updates the pages after a user-visible change, and the
  [`docs-auditor`](../../.claude/agents/docs-auditor.md) agent audits them read-only against the
  code and deploy state and reports stale claims.

Any change that alters what people or agents can do or see updates `public/docs/` in the same
change, and `node scripts/check-docs.mjs` must pass.

## Configuration

No bindings, vars or secrets. Deploy through an environment: `pnpm env:provision <env>`, then
`pnpm env:deploy <env> --only site` (see
[30-environments](../../docs/claude-opus/30-environments.md); where `urls.site` equals
`urls.web`, the web's generated config gets the `SITE` binding and the site gets no hostname of
its own). Never `wrangler deploy`
the template; the package's `deploy` script deliberately fails.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md); run `pnpm check` at the root before sending a change.
