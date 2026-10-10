---
description: Connect git on this machine to your Gitstalk account (pick an SSH key, approve it once in the browser)
argument-hint: "[owner/repo]"
---

Connect this machine's git to the person's Gitstalk account, then carry on with what they
asked. Follow the `gitstalk` skill, section "Connecting git". The script is bundled with this
plugin; it sends only a public key, never prints secrets, and touches git config for the
Gitstalk host only.

Script: `sh "${CLAUDE_PLUGIN_ROOT}/scripts/gitstalk-setup.sh"` (on Windows without Git Bash:
`powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/gitstalk-setup.ps1"`,
same subcommands, options as `-Key`, `-AgentKey`, `-Agent`, `-NoBrowser`).

1. Run `<script> detect`. It prints facts (`platform:`, `ssh_keygen:`, `ssh_host:` …) and one
   tab-separated `option` line per key: source (`1password`, `ssh-agent`, `file`, `generate`),
   fingerprint, type, comment, and the socket or file.
2. If `ssh_keygen: no`, tell the person how to install OpenSSH and stop. If the only option is
   `generate`, skip the question and generate. Otherwise ask ONE question with
   AskUserQuestion, one choice per option, best first: a 1Password key ("Use 1Password key
   <comment> (SHA256:abcd…)", recommended: the private key never leaves 1Password), then
   ssh-agent keys, then key files, then "Generate a new key for Gitstalk". The person can
   also type another answer ("Other"); follow it.
3. To generate: `<script> generate`. It makes `~/.ssh/gitstalk_ed25519` without a passphrase
   (a script cannot type one); say they can add one later with `ssh-keygen -p -f ~/.ssh/gitstalk_ed25519`.
4. Register, with a 10-minute Bash timeout (600000 ms):
   - key file: `<script> register --key <path to the .pub>`
   - agent key: `<script> register --agent-key <fingerprint> --agent "<socket from the option line>"`
   Before it runs, tell the person: a browser tab opens on Gitstalk; check that it shows the
   same code and fingerprint, then click Add key (sign in with their passkey if asked). If the
   output says `approve: on any signed-in device, open … and enter …`, show that URL and code
   prominently: they approve from another device. `approved:` means done; on `declined` or
   `expired`, say so and offer to run register again.
5. If `$ARGUMENTS` names `owner/repo`: in a clone of it, `<script> remote owner/repo`; elsewhere
   `<script> remote owner/repo` clones it into `./repo`. Then `<script> verify owner/repo`
   (or `<script> verify` with no repository).
6. Report in two or three lines: the account (`whoami:`), the key, and the remote. If the
   output says `transport: HTTPS`, add that git over SSH is not live yet, so git uses an HTTPS
   token kept by the OS keychain (or git's credential store) for now. Then continue with the
   person's task.

Never read, print or send a private key, a token, `~/.git-credentials` or keychain contents.
Never change git credential settings for any host other than Gitstalk's.
