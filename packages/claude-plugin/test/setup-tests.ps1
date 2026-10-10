# Tests for scripts/gitstalk-setup.ps1 against fake-gitstalk.mjs (GITSTALK_TEST_SERVER),
# in a throwaway HOME with its own git config, a throwaway ssh-agent and throwaway keys.
# Run in a pwsh container by run-containers.sh; not tested on real Windows here.
$ErrorActionPreference = 'Continue'
$Setup = Join-Path $PSScriptRoot '../scripts/gitstalk-setup.ps1'
$Root = Join-Path ([IO.Path]::GetTempPath()) ("bsp" + (Get-Random))
New-Item -ItemType Directory -Path $Root | Out-Null
$script:Passed = 0
$script:Failed = 0

$env:HOME = Join-Path $Root 'h'
Set-Variable -Name HOME -Value $env:HOME -Force -Scope Global -ErrorAction SilentlyContinue
$env:GIT_CONFIG_GLOBAL = Join-Path $env:HOME '.gitconfig'
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:XDG_CONFIG_HOME = Join-Path $env:HOME '.config'
$env:GITSTALK_CREDENTIAL_HELPER = 'store'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GITSTALK_WEB = $env:GITSTALK_TEST_SERVER
$env:DISPLAY = ':0'
Remove-Item Env:SSH_AUTH_SOCK, Env:SSH_CONNECTION -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $env:HOME '.ssh') | Out-Null
Set-Content -Path $env:GIT_CONFIG_GLOBAL -Value ''
$browser = Join-Path $Root 'fake-browser'
Set-Content -Path $browser -Value "#!/bin/sh`nprintf '%s\n' `"`$1`" >> '$Root/browser.log'"
chmod +x $browser
$env:BROWSER = $browser

function Check([string]$Name, [bool]$Ok, $Output) {
  if ($Ok) { $script:Passed++; Write-Output "ok   $Name" } else { $script:Failed++; Write-Output "FAIL $Name"; Write-Output ($Output | Out-String) }
}
function Setup { & ([Environment]::ProcessPath) -NoProfile -File $Setup @args 2>&1 }

$agentOut = & ssh-agent -s -a (Join-Path $Root 'agent.sock')
$agentPid = (($agentOut | Select-String 'SSH_AGENT_PID=(\d+)').Matches[0].Groups[1].Value)
$env:SSH_AUTH_SOCK = Join-Path $Root 'agent.sock'
& ssh-keygen -q -t ed25519 -N '' -C file-key -f (Join-Path $env:HOME '.ssh/id_ed25519')
& ssh-keygen -q -t ed25519 -N '' -C agent-key -f (Join-Path $Root 'agent_key')
& ssh-add -q (Join-Path $Root 'agent_key') 2>$null
$agentFp = ((& ssh-keygen -lf (Join-Path $Root 'agent_key.pub')) -split ' ')[1]
$fileFp = ((& ssh-keygen -lf (Join-Path $env:HOME '.ssh/id_ed25519.pub')) -split ' ')[1]

try {
  Check 'no credential helper is configured before setup' (-not (& git config --get-all credential.helper)) ''
  $out = Setup detect
  Check 'detect lists the ssh-agent key' ([bool]($out -match "^option`tssh-agent`t$([regex]::Escape($agentFp))`tssh-ed25519`tagent-key")) $out
  Check 'detect lists ~/.ssh key files' ([bool]($out -match "^option`tfile`t$([regex]::Escape($fileFp))")) $out
  Check 'detect offers to generate a key' ([bool]($out -match "^option`tgenerate")) $out

  $out = Setup generate
  Check 'generate makes ~/.ssh/gitstalk_ed25519' (Test-Path (Join-Path $env:HOME '.ssh/gitstalk_ed25519.pub')) $out

  $out = Setup register -Key (Join-Path $env:HOME '.ssh/gitstalk_ed25519.pub')
  Check 'register (browser) is approved and stores the HTTPS token' ([bool]($out -match '^approved: key added to @smoke') -and [bool]($out -match '^https_token: stored')) $out
  Check 'register opened the approval page with the code' ((Get-Content (Join-Path $Root 'browser.log') -Raw) -match 'code=BCDF-GHJK') ''
  Check 'register never prints the token' (-not ($out -match 'bsu_')) $out
  $origin = "$($env:GITSTALK_WEB)/"
  $helpers = (& git config --get-all "credential.$origin.helper") -join ','
  Check 'the credential helper is scoped to the Gitstalk host only' ($helpers -eq ',store') $helpers

  $out = Setup verify smoke/demo
  Check 'verify names the account and reaches the repository' ([bool]($out -match '^whoami: @smoke') -and [bool]($out -match '^ls_remote: smoke/demo ok')) $out
  Push-Location $Root
  $out = Setup remote smoke/demo (Join-Path $Root 'clone')
  Pop-Location
  Check 'remote clones over HTTPS without a prompt' (Test-Path (Join-Path $Root 'clone/README')) $out

  Remove-Item (Join-Path $Root 'browser.log') -ErrorAction SilentlyContinue
  $out = Setup register -AgentKey $agentFp -NoBrowser
  Check 'register -NoBrowser shows the page and code to enter' ([bool]($out -match 'enter BCDF-GHJK') -and -not (Test-Path (Join-Path $Root 'browser.log'))) $out

  Invoke-RestMethod -Method Post -Uri "$($env:GITSTALK_WEB)/__mode?deny=1" | Out-Null
  $out = Setup register -Key (Join-Path $env:HOME '.ssh/id_ed25519.pub')
  Check 'a declined request fails and says so' ([bool]($out -match 'declined')) $out
} finally {
  if ($agentPid) { Stop-Process -Id ([int]$agentPid) -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force $Root -ErrorAction SilentlyContinue
}
Write-Output ''
Write-Output "$($script:Passed) passed, $($script:Failed) failed (PowerShell $($PSVersionTable.PSVersion), $(git --version))"
if ($script:Failed -gt 0) { exit 1 }
