#!/bin/sh
# Tests for scripts/beanstalk-setup.sh and the "Env vars" git configuration, against
# fake-beanstalk.mjs. Everything runs in a throwaway HOME with its own git config, its own
# ssh-agents and throwaway keys; the person's own agent, keys, keychain and git config are
# never read or written (GIT_CONFIG_NOSYSTEM, BEANSTALK_CREDENTIAL_HELPER=store).
#
#   sh setup-tests.sh                    starts the fake server itself (needs node)
#   BEANSTALK_TEST_SERVER=http://host:port sh setup-tests.sh
#                                        uses a server started elsewhere (Linux containers)
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SETUP=$HERE/../scripts/beanstalk-setup.sh
# Unix socket paths must stay short (104 bytes on macOS), so the sandbox lives under /tmp.
ROOT=$(mktemp -d /tmp/bst.XXXXXX)
PASSED=0
FAILED=0
AGENTS=

cleanup() {
  for pid in $AGENTS; do kill "$pid" 2>/dev/null; done
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

export HOME="$ROOT/h"
export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
export GIT_CONFIG_NOSYSTEM=1
export XDG_CONFIG_HOME="$HOME/.config"
export BEANSTALK_CREDENTIAL_HELPER=store
export BROWSER="$ROOT/fake-browser"
export GIT_TERMINAL_PROMPT=0
unset SSH_AUTH_SOCK SSH_AGENT_PID SSH_CONNECTION DISPLAY WAYLAND_DISPLAY BEANSTALK_NO_BROWSER
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
: >"$GIT_CONFIG_GLOBAL"
git config --global user.name test
git config --global user.email test@example.invalid
git config --global init.defaultBranch main
printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"%s/browser.log"\n' "$ROOT" >"$BROWSER"
chmod +x "$BROWSER"

pass() { PASSED=$((PASSED + 1)); printf 'ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     /'; }
check() { if eval "$2"; then pass "$1"; else fail "$1" "${3:-}"; fi; }

start_agent() {
  eval "$(ssh-agent -s -a "$1")" >/dev/null
  AGENTS="$AGENTS $SSH_AGENT_PID"
  unset SSH_AGENT_PID
}

fingerprint() { ssh-keygen -lf "$1" | awk '{print $2}'; }

# --- the fake Beanstalk --------------------------------------------------------------------
if [ -n "${BEANSTALK_TEST_SERVER:-}" ]; then
  export BEANSTALK_WEB=$BEANSTALK_TEST_SERVER
else
  mkdir -p "$ROOT/repos/smoke"
  git init -q --bare "$ROOT/repos/smoke/demo.git"
  git clone -q "$ROOT/repos/smoke/demo.git" "$ROOT/seed" 2>/dev/null
  (cd "$ROOT/seed" && echo hi >README && git add README && git commit -qm init && git push -q origin HEAD:main)
  node "$HERE/fake-beanstalk.mjs" 0 "$ROOT/repos" >"$ROOT/port" &
  SERVER_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$ROOT/port" ] && break; sleep 0.2; done
  export BEANSTALK_WEB="http://127.0.0.1:$(cat "$ROOT/port")"
fi
curl -fsS -X POST "$BEANSTALK_WEB/__mode" >/dev/null || { echo "fake server unreachable at $BEANSTALK_WEB"; exit 1; }
ORIGIN=$BEANSTALK_WEB
HOST=${ORIGIN#*://}

# --- keys: a file key, a "1Password" agent, and a plain ssh-agent --------------------------
ssh-keygen -q -t ed25519 -N '' -C file-key -f "$HOME/.ssh/id_ed25519"
ssh-keygen -q -t ed25519 -N '' -C onepassword-key -f "$ROOT/op_key"
ssh-keygen -q -t ecdsa -b 256 -N '' -C agent-key -f "$ROOT/agent_key"
case $(uname -s) in
  Darwin) OP_SOCK="$HOME/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock" ;;
  *) OP_SOCK="$HOME/.1password/agent.sock" ;;
esac
mkdir -p "$(dirname "$OP_SOCK")"
start_agent "$OP_SOCK"
SSH_AUTH_SOCK=$OP_SOCK ssh-add -q "$ROOT/op_key" 2>/dev/null
start_agent "$ROOT/agent.sock"
export SSH_AUTH_SOCK="$ROOT/agent.sock"
ssh-add -q "$ROOT/agent_key" 2>/dev/null

check 'no credential helper is configured before setup (nothing can reach a real store)' \
  '[ -z "$(git config --get-all credential.helper)" ]'

# --- detect --------------------------------------------------------------------------------
out=$(sh "$SETUP" detect 2>&1)
tab=$(printf '\t')
check 'detect lists the 1Password agent key' \
  'printf "%s\n" "$out" | grep -q "^option${tab}1password${tab}$(fingerprint "$ROOT/op_key.pub")${tab}ssh-ed25519${tab}onepassword-key"' "$out"
check 'detect lists the ssh-agent key' \
  'printf "%s\n" "$out" | grep -q "^option${tab}ssh-agent${tab}$(fingerprint "$ROOT/agent_key.pub")${tab}ecdsa-sha2-nistp256"' "$out"
check 'detect lists ~/.ssh key files' \
  'printf "%s\n" "$out" | grep -q "^option${tab}file${tab}$(fingerprint "$HOME/.ssh/id_ed25519.pub")${tab}.*${tab}$HOME/.ssh/id_ed25519.pub"' "$out"
check 'detect offers to generate a key' 'printf "%s\n" "$out" | grep -q "^option${tab}generate"' "$out"
check 'detect reports ssh-keygen and the git origin' \
  'printf "%s\n" "$out" | grep -q "^ssh_keygen: yes" && printf "%s\n" "$out" | grep -q "^git_origin: $ORIGIN"' "$out"

# --- generate ------------------------------------------------------------------------------
out=$(sh "$SETUP" generate 2>&1)
check 'generate makes ~/.ssh/beanstalk_ed25519 with a beanstalk comment' \
  '[ -f "$HOME/.ssh/beanstalk_ed25519" ] && grep -q "beanstalk " "$HOME/.ssh/beanstalk_ed25519.pub"' "$out"
check 'generate refuses to overwrite a key' '! sh "$SETUP" generate >/dev/null 2>&1'

# --- register through the browser ----------------------------------------------------------
# A desktop session (on Linux a browser needs a display; without one setup shows a code).
out=$(DISPLAY=:0 sh "$SETUP" register --key "$HOME/.ssh/beanstalk_ed25519.pub" 2>&1)
status=$?
check 'register (browser) is approved and stores the HTTPS token' \
  '[ $status -eq 0 ] && printf "%s\n" "$out" | grep -q "^approved: key added to @smoke" && printf "%s\n" "$out" | grep -q "^https_token: stored"' "$out"
check 'register opened the approval page with the code' 'grep -q "/settings/keys/add?code=BCDF-GHJK" "$ROOT/browser.log"'
check 'register never prints the token' '! printf "%s\n" "$out" | grep -q "bsu_"' "$out"
state=$(curl -fsS "$BEANSTALK_WEB/__state")
check 'register sent only the public key, the machine name and asked for a token' \
  'printf "%s" "$state" | grep -q "\"public_key\":\"$(cut -d" " -f1-2 "$HOME/.ssh/beanstalk_ed25519.pub")" && printf "%s" "$state" | grep -q "\"https_token\":true" && ! printf "%s" "$state" | grep -q PRIVATE' "$state"
helpers=$(git config --get-all "credential.$ORIGIN/.helper" | tr '\n' ',')
check 'the credential helper is scoped to the Beanstalk host only (reset, then store)' \
  '[ "$helpers" = ",store," ] && [ -z "$(git config --get-all credential.helper)" ]' "$helpers"
check 'the token sits in git-credentials (0600), for this host only' \
  '[ "$(ls -l "$HOME/.git-credentials" | cut -c1-10)" = "-rw-------" ] && grep -q "@${HOST%%:*}" "$HOME/.git-credentials"'

# --- verify, clone, remote -----------------------------------------------------------------
out=$(sh "$SETUP" verify smoke/demo 2>&1)
check 'verify names the account and reaches the repository' \
  'printf "%s\n" "$out" | grep -q "^whoami: @smoke" && printf "%s\n" "$out" | grep -q "^ls_remote: smoke/demo ok"' "$out"
out=$(cd "$ROOT" && sh "$SETUP" remote smoke/demo "$ROOT/clone" 2>&1)
check 'remote clones over HTTPS without a prompt' '[ -f "$ROOT/clone/README" ]' "$out"
out=$(cd "$ROOT/clone" && git remote set-url origin https://example.invalid/x.git && sh "$SETUP" remote smoke/demo 2>&1)
check 'remote points an existing clone back at Beanstalk' \
  '[ "$(git -C "$ROOT/clone" remote get-url origin)" = "$ORIGIN/smoke/demo.git" ]' "$out"
out=$(cd "$ROOT/clone" && git switch -q -c "bean/x$$" && echo more >>README && git commit -qam more && git push -q origin "bean/x$$" 2>&1)
status=$?
check 'git push uses the stored credential silently' '[ $status -eq 0 ]' "$out"

# --- register from the agent without a browser, deny, headless -----------------------------
: >"$ROOT/browser.log"
out=$(sh "$SETUP" register --agent-key "$(fingerprint "$ROOT/agent_key.pub")" --no-browser 2>&1)
check 'register --no-browser shows the page and code to enter on another device' \
  'printf "%s\n" "$out" | grep -q "open $ORIGIN/settings/keys/add and enter BCDF-GHJK" && [ ! -s "$ROOT/browser.log" ]' "$out"
out=$(SSH_CONNECTION='10.0.0.1 1 10.0.0.2 22' sh "$SETUP" register --agent-key "$(fingerprint "$ROOT/op_key.pub")" --agent "$OP_SOCK" 2>&1)
check 'over SSH (headless) the browser is not opened' \
  '[ ! -s "$ROOT/browser.log" ] && printf "%s\n" "$out" | grep -q "enter BCDF-GHJK"' "$out"
curl -fsS -X POST "$BEANSTALK_WEB/__mode?deny=1" >/dev/null
out=$(sh "$SETUP" register --key "$HOME/.ssh/id_ed25519.pub" 2>&1)
status=$?
check 'a declined request fails and says nothing was added' \
  '[ $status -ne 0 ] && printf "%s\n" "$out" | grep -q "declined"' "$out"
check 'a private key is refused before anything is sent' \
  '! sh "$SETUP" register --key "$HOME/.ssh/id_ed25519" >/dev/null 2>&1'

# --- once the SSH endpoint is live ---------------------------------------------------------
curl -fsS -X POST "$BEANSTALK_WEB/__mode?ssh=ssh.beanstalk.test" >/dev/null
out=$(sh "$SETUP" register --agent-key "$(fingerprint "$ROOT/op_key.pub")" --agent "$OP_SOCK" --no-browser 2>&1)
state=$(curl -fsS "$BEANSTALK_WEB/__state")
check 'with SSH live, register asks for no HTTPS token' \
  'printf "%s\n" "$out" | grep -q "^approved" && printf "%s" "$state" | tr "}" "\n" | tail -n 2 | grep -q "\"https_token\":false"' "$out"
mkdir -p "$ROOT/sshrepo" && git -C "$ROOT/sshrepo" init -q
out=$(cd "$ROOT/sshrepo" && sh "$SETUP" remote smoke/demo 2>&1)
check 'with SSH live, remote uses ssh:// and points ssh at the chosen agent key for that host only' \
  '[ "$(git -C "$ROOT/sshrepo" remote get-url origin)" = "ssh://git@ssh.beanstalk.test/smoke/demo.git" ] && grep -q "^Host ssh.beanstalk.test" "$HOME/.ssh/config" && grep -q "IdentityAgent \"$OP_SOCK\"" "$HOME/.ssh/config"' "$out"
curl -fsS -X POST "$BEANSTALK_WEB/__mode" >/dev/null

# --- the "Env vars" block (CI): no helper, no prompt -------------------------------------------
env_ls_remote() {
  env -i PATH="$PATH" HOME="$ROOT/ci" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$ROOT/ci/.gitconfig" \
    BEANSTALK_TOKEN="$1" GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="$2" GIT_CONFIG_VALUE_0="$3" git ls-remote "$ORIGIN/smoke/demo.git" 2>&1
}
mkdir -p "$ROOT/ci" && : >"$ROOT/ci/.gitconfig"
HELPER='!f() { echo "username=x"; echo "password=$BEANSTALK_TOKEN"; }; f'
out=$(env_ls_remote bsd_fake_deploy "credential.$ORIGIN.helper" "$HELPER")
check 'env vars: the credential-helper variant reads BEANSTALK_TOKEN' 'printf "%s\n" "$out" | grep -q "refs/heads/main"' "$out"
out=$(env_ls_remote bsd_fake_deploy "http.$ORIGIN/.extraheader" 'Authorization: Bearer bsd_fake_deploy')
check 'env vars: the extraheader Bearer variant works' 'printf "%s\n" "$out" | grep -q "refs/heads/main"' "$out"
out=$(env_ls_remote '' "core.askPass" '')
check 'without a credential git fails at once and prints the hint as remote: lines' \
  'printf "%s\n" "$out" | grep -q "terminal prompts disabled\|remote: Beanstalk"' "$out"

printf '\n%s passed, %s failed (git %s, %s)\n' "$PASSED" "$FAILED" "$(git --version | cut -d" " -f3)" "$(uname -s)"
[ "$FAILED" -eq 0 ]
