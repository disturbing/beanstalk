# Real three-agent trial harness

`server.mjs` bundles the installed checkout's production MCP and gateway Workers using
Wrangler's installed esbuild. Their service binding is real RPC and their RunDO/RunIndex
storage is SQLite persisted in `state/`. A tiny front Worker routes external localhost
HTTP to the proper Worker; the MCP Worker talks to the gateway via its service binding.
The first startup freezes the compiled bundle under `bundle/`; restarts reuse that exact
code snapshot even when other agents are concurrently editing the source checkout.
For a new trial against changed forge code, use a fresh runtime directory or remove only
the cached bundles after stopping the previous trial.

Fresh native app repository: `/Users/coop/Workspace/beanstalk-collaboration-demo`.
The acceptance suite was written before any agent implemented modules. The coordinator
should freeze and commit it, then create three exclusive participant worktrees.

CLI examples:

```sh
node /private/tmp/beanstalk-three-agent-trial/client.mjs shipping list
node /private/tmp/beanstalk-three-agent-trial/client.mjs shipping bean_context '{"bean":"t001"}'
node /private/tmp/beanstalk-three-agent-trial/client.mjs checkout bean_inbox_read '{"state":"unread"}'
node /private/tmp/beanstalk-three-agent-trial/client.mjs returns bean_thread_post @/private/tmp/my-thread-input.json
node /private/tmp/beanstalk-three-agent-trial/restart.mjs
```

Roles: `shipping` owns t001, `checkout` owns t002, `returns` owns t003. `view` gets read-only
tools. Only protected per-role files under `private/` hold tokens; do not print their
contents or copy them into repositories. `evidence/<role>.jsonl` records MCP requests,
replies and errors with credential fields redacted. Reconnects happen independently on
every CLI invocation. `restart.mjs` gracefully stops/restarts Workers on the same port,
retaining canonical run state and credentials; it records process/run metadata only.

No run is started and no container executes. Cloudflare Artifacts and the container runner
are the existing gateway suite's external stand-ins. Those stand-ins have ephemeral
module memory, so after restart observed Git context can become unavailable; canonical
bean history, lexical approaches, promise/reliance state, inboxes and acknowledgements
remain in SQLite. Native Git app worktrees and coordinator merges validate independently
authored code compatibility, not Artifacts transport or automatic engine landing.

To stop after evidence capture, read the PID from `ready.json` and send SIGTERM.
Public run metadata is in `ready.json`; it contains no grants or credentials.
