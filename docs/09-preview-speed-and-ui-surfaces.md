# Fast visual inspection without pretending every build is instant

Design revision, 3 October 2026. Trigger: the first canvas concept showed too little application UI and made branch previews look free and immediate. This proposal corrects both. No cloud preview latency has been measured for Beanstalk.

## The direct answer

Yes: cloning, installing dependencies, building, provisioning a database, starting a server, and capturing a browser can take substantial time. Doing that for every agent push and every canvas question would produce a slow and expensive product.

The proposed experience has three main paths: **show existing visuals**, **interact with a warm development session**, and **prepare an exact-version review preview**. A person can examine available UI evidence while a slower path runs. There is no honest shortcut to showing new code that has never been rendered.

The generated Beanstalk interface and the repository's application have independent preparation costs. Jev chooses Beanstalk view components from a supplied catalog; it does not compile someone else's React app. Already available data can render without starting that app. [Current Jev composition API](https://json-render.dev/docs/jev).

## What appears, and when

| Path | Actual work | What the user may do | What it does not establish |
| --- | --- | --- | --- |
| Saved capture | Authorize and load an existing screenshot, DOM/accessibility snapshot or video | Inspect a known screen and its linked source/evidence | Current branch appearance if the capture is older; live interactions |
| Existing component bundle | Load a previously built story/harness plus its recorded fixture | Try supported component states without starting the whole backend | Real backend integration or arbitrary uncaptured app behavior |
| Warm development session | Apply/synchronize the selected revision in an isolated existing environment, then HMR/reload or restart | Click the actual app or component and iterate quickly | A stable review artifact or successful production build |
| Cold development session | Queue, start/restore environment, materialize source, install missing dependencies, boot services | Interact once ready; inspect previous evidence while waiting | Instant availability or complete environment fidelity |
| Pinned review preview | Build/reuse the exact artifact, provision declared fixtures, authorize and verify readiness | Review a fixed candidate and attach observations to it | Passing all acceptance checks merely because the server responds |

“Saved capture available” applies only if a suitable capture already exists. Initial import has real setup and capture work. If rendering fails, show the failure and source diff; an AI reconstruction must never fill the gap while pretending to be observed application UI.

## A concrete warm path

For an initial React/Vite profile, prepare dependencies once per approved toolchain/lockfile combination. Maintain a small pool of isolated active sessions for work receiving attention. The agent may already have a suitable development server running; with the same trust boundary and authorization, expose that session through the preview gateway rather than create another copy solely for the canvas.

For a component-only edit, let the dev server transform the changed module and refresh the relevant frame. Vite supports HMR and framework integrations such as React Fast Refresh, but its TypeScript transforms do not perform type checking. Fast visible feedback must therefore have a separate “checks pending” state. Some changes require a reload, dependency re-optimization or a server restart. [Vite features](https://vite.dev/guide/features.html).

Do not let every agent modify one warm filesystem. A session belongs to an isolated attempt/trust boundary. Reuse immutable dependency layers and caches; separate writable source, processes, credentials, browser storage and test data. Keep hot sessions for active reviewers or important attempts, and expire others under explicit limits.

For a review, select an exact change/candidate revision and build or reuse its immutable artifact in a separate environment. The development session can continue advancing, but its mutable iframe must not become the evidence for a different fixed revision. Capture a stable checkpoint with a recorded source digest; clean-start the review build when HMR-carried state could conceal a defect.

## Where the actual UI elements come from

Start with repositories that have Storybook or a small approved component harness. A story supplies the component, props, state and necessary context. Themes, providers and layout wrappers are often necessary to render correctly; Storybook's decorators explicitly support these contexts. [Storybook decorators](https://storybook.js.org/docs/writing-stories/decorators).

An existing static Storybook build can be served as a cached component explorer. Producing that bundle still requires a build; changing the source requires updated output. Component isolation may avoid running the whole application, but a static build can still compile a large dependency graph. [Publishing Storybook](https://storybook.js.org/docs/sharing/publish-storybook).

When a component cannot run in isolation—server-only logic, complex providers, application-level routing—preview its route in a supported app runtime. Show backend-only changes as API scenarios, responses or traces. Do not force every repository into a visual-component model.

Jev can choose a `ComponentGallery`, `ScreenFrame`, `BeforeAfter`, `StateControls` or `ElementInspector` view. These Beanstalk components embed actual application renders or recorded evidence. Selecting “error” changes a known fixture/scenario; it does not ask a model to invent what the application would look like.

## Avoid repeated work without making stale work look current

- **Prepare on intent, not on hover.** When an agent begins work on a supported screen, admit its warm session if there is budget. A hover may raise priority; it should not silently fan out expensive builds.
- **Coalesce intermediate pushes.** For discovery previews, cancel superseded queued jobs and build the latest requested revision after a short debounce. Preserve explicitly pinned reviews and their immutable targets.
- **Deduplicate identical requests.** Multiple viewers asking for the same artifact/environment join one preparation operation, with independently authorized viewing and isolated mutable sessions where needed.
- **Cache immutable outputs.** Key by exact inputs: source/commit as required, toolchain, dependency graph, build recipe, environment/fixture versions and trust domain. Cross-tenant or untrusted cache reuse needs explicit protection.
- **Reuse expensive dependency preparation.** A cache hit can avoid downloads or compilation; it does not always avoid installation/linking/postinstall work.
- **Capture affected scenarios selectively.** Use dependency analysis to prioritize routes/components, with conservative fallback when dynamic imports or global styles make impact uncertain.
- **Keep only useful environments hot.** Thousands of stored attempts can share a bounded active execution pool. Schedule captures and browser sessions separately from coding agents.
- **Keep approval distinct.** Visual similarity and a ready server do not authorize merging. Required checks still apply to the exact integrated candidate.

Cloudflare Workers Builds supports project-wide dependency/build caching for documented package managers and frameworks. Its package-manager entries are cache directories, not a guarantee that `node_modules` is already installed. Those managed build caches also do not automatically become the cache of a custom Beanstalk container scheduler. [Workers build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/).

## Cloudflare's role

Use Workers for the canvas API, authorization and preview routing; R2 for retained visuals and build evidence; Containers/Sandboxes for Linux tooling and development servers; and Workers-compatible deployments for apps that support that runtime. Existing third-party preview deployments can also be linked through an authorized integration instead of rebuilt.

Dynamic Workers load executable Worker modules at runtime. Their loader has no build step; TypeScript must be compiled and dependencies prepared first. That can shorten runtime provisioning for compatible prepared code; it does not perform an arbitrary repository's dependency install, TypeScript/JSX build, database migration or browser capture. Keep those costs in the model. [Dynamic Workers setup](https://developers.cloudflare.com/dynamic-workers/getting-started/).

A restored filesystem snapshot can save setup work but still needs processes and health checks: Cloudflare snapshots retain filesystem contents, not running processes or memory. The dev server must restart. [Sandbox lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/).

Cloudflare's September 30 announcement reports 648 ms median and 910 ms p95 for its 100-sandbox command-readiness benchmark, then explicitly describes clone/install/toolchain setup as additional work. Those numbers are not app-preview timings. Do not equate container startup, first HTTP response, first useful screen, and successful scenario completion. [Sandbox startup benchmark](https://blog.cloudflare.com/faster-agent-sandboxes/). See the [identity/preview design](06-identity-mcp-and-live-previews.md) for isolation and the [Actions design](05-github-actions-portability.md) for execution limits.

## Proposed latency targets to test

These are **unmeasured product targets for a small supported app**, not provider guarantees or estimates for arbitrary imported repositories.

| Measurement | Initial target | Key condition |
| --- | --- | --- |
| Display an authorized, already cached visual after the view is selected | p95 under 1 second | Excludes Jev selection latency; image/data already exist |
| Show a small UI edit in a warm session | p95 under 2 seconds after filesystem update | Dependencies stable, healthy dev server, supported HMR boundary |
| Make a supported cold session interactive | p95 under 30 seconds | Prebuilt toolchain, suitable dependencies, small synthetic dataset |
| Prepare a cached, production-style review preview | p95 under 60 seconds | Supported small app; full acceptance suite measured separately |

A first import, new dependency graph, large monorepo, native compile, service setup or migration may take minutes or fail to fit the profile. Report measured progress and reasons instead of a fictional countdown. If a target fails, retain that failure in the benchmark and revise scope or engineering—not the observed number.

Instrument stages separately: queue delay → environment start/restore → checkout/sync → dependency preparation → transform/build → services/fixture → readiness → browser/auth → first useful render → scenario completion. Record cold/warm status, cache hits, app size, runtime/image digest, region, sample count, p50/p95 and total cost. Run small CSS edits, component logic edits, lockfile changes, server changes, migrations and combined candidates. Compare with the team's existing preview workflow.

## Smallest implementation worth building

Start with one React/Vite repository and its existing stories or two full routes. Add a baseline capture, one warm agent session, before/after rendering, explicit readiness, and a separately pinned review build. Reuse the established dev server and build tools. A universal preview platform for every language and architecture is a much larger project and is not necessary to validate the canvas.

The revised [local concept](canvas-concept.html) illustrates these states with authored components and simulated readiness. Its buttons and timers are interface demonstrations; they are not measured build times or a live connection to repository code.
