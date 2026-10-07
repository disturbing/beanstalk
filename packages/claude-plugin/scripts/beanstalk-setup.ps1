<#
Beanstalk setup for Windows (PowerShell 5.1 or 7): connect this machine's git to a Beanstalk
account, once. The same commands and output as beanstalk-setup.sh (which Git for Windows' bash
also runs):

  beanstalk-setup.ps1 detect
  beanstalk-setup.ps1 generate [-File PATH]
  beanstalk-setup.ps1 register (-Key FILE.pub | -AgentKey SHA256:... [-Agent SOCKET]) [-NoBrowser]
  beanstalk-setup.ps1 remote OWNER/REPO [DIR]
  beanstalk-setup.ps1 verify [OWNER/REPO]

Needs git and OpenSSH (Windows 10/11's built-in OpenSSH or Git for Windows' ssh-keygen).
Private keys never leave this machine; secrets are never printed. Settings: BEANSTALK_WEB,
BEANSTALK_CREDENTIAL_HELPER, BEANSTALK_NO_BROWSER=1 (as for the sh script).
#>
param(
  [Parameter(Position = 0)][string]$Command = '',
  [Parameter(Position = 1)][string]$Repo = '',
  [Parameter(Position = 2)][string]$Dir = '',
  [string]$File = '',
  [string]$Key = '',
  [string]$AgentKey = '',
  [string]$Agent = '',
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$Web = if ($env:BEANSTALK_WEB) { $env:BEANSTALK_WEB.TrimEnd('/') } else { 'https://beanstalk-web.devaccounts-1password.workers.dev' }
$ConfigRoot = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } elseif ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME '.config' }
$ConfigDir = Join-Path $ConfigRoot 'beanstalk'
$IsWin = [System.Environment]::OSVersion.Platform -eq 'Win32NT'
$OnePasswordPipe = '\\.\pipe\openssh-ssh-agent'
# An empty argument for native commands: PowerShell 7.3+ passes '' as is; older ones drop it.
$EmptyArg = if ($PSVersionTable.PSVersion -ge [version]'7.3') { '' } else { '""' }

function Say([string]$Text) { Write-Output $Text }
function Fail([string]$Text) { [Console]::Error.WriteLine("beanstalk: $Text"); exit 1 }

function Get-SetupConfig {
  try { $config = Invoke-RestMethod -Uri "$Web/api/setup" -TimeoutSec 20 } catch { Fail "cannot reach $Web (check BEANSTALK_WEB and the network)" }
  $origin = $config.git_origin.TrimEnd('/')
  $uri = [Uri]$origin
  [pscustomobject]@{
    Origin = $origin
    Proto = $uri.Scheme
    Host = $uri.Authority
    SshHost = if ($config.ssh_host) { [string]$config.ssh_host } else { '' }
  }
}

function Get-Platform {
  if ($IsWin) { return 'windows' }
  if ($IsMacOS) { return 'macos' }
  return 'linux'
}

function Get-MachineName { ([Environment]::MachineName -split '\.')[0] }

function Get-Fingerprint([string]$Line) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmp -Value $Line -NoNewline:$false
    ((& ssh-keygen -lf $tmp 2>$null) -split ' ')[1]
  } finally { Remove-Item $tmp -Force }
}

function Get-OnePasswordSocket {
  if ($IsWin) { if (Test-Path $OnePasswordPipe) { return $OnePasswordPipe } else { return $null } }
  foreach ($sock in @((Join-Path $HOME 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'), (Join-Path $HOME '.1password/agent.sock'))) {
    if (Test-Path $sock) { return $sock }
  }
  return $null
}

function Get-AgentLines([string]$Socket) {
  $saved = $env:SSH_AUTH_SOCK
  try {
    if (-not $IsWin) { $env:SSH_AUTH_SOCK = $Socket }
    @(& ssh-add -L 2>$null) | Where-Object { $_ -match '^(ssh-|ecdsa-)' }
  } catch { @() } finally { $env:SSH_AUTH_SOCK = $saved }
}

function Write-Option([string]$Source, [string]$Line, [string]$Where) {
  $parts = $Line -split ' ', 3
  $comment = if ($parts.Count -gt 2) { $parts[2] } else { '' }
  Say ("option`t{0}`t{1}`t{2}`t{3}`t{4}" -f $Source, (Get-Fingerprint $Line), $parts[0], $comment, $Where)
}

function Invoke-Detect {
  Say "platform: $(Get-Platform)"
  $keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
  if ($keygen) { Say "ssh_keygen: yes ($((& ssh -V 2>&1 | Select-Object -First 1)))" } else { Say 'ssh_keygen: no (install OpenSSH: Settings > Optional features, or Git for Windows)' }
  $opener = Get-BrowserOpener
  Say "browser: $(if ($opener) { $opener } else { 'none' })"
  Say "headless: $(if (Test-Headless) { 'yes' } else { 'no' })"
  $config = Get-SetupConfig
  Say "git_origin: $($config.Origin)"
  Say "ssh_host: $(if ($config.SshHost) { $config.SshHost } else { 'none yet (setup uses HTTPS with a token until SSH is live)' })"
  $helper = & git config --get-urlmatch credential.helper "$($config.Proto)://$($config.Host)/" 2>$null
  Say "credential_helper: $(if ($helper) { $helper } else { 'none' })"
  $op = Get-OnePasswordSocket
  if ($op) { foreach ($line in Get-AgentLines $op) { Write-Option '1password' $line $op } }
  if ($env:SSH_AUTH_SOCK -and $env:SSH_AUTH_SOCK -ne $op) {
    foreach ($line in Get-AgentLines $env:SSH_AUTH_SOCK) { Write-Option 'ssh-agent' $line $env:SSH_AUTH_SOCK }
  }
  foreach ($pub in Get-ChildItem -Path (Join-Path $HOME '.ssh') -Filter '*.pub' -ErrorAction SilentlyContinue) {
    $line = Get-Content $pub.FullName -TotalCount 1
    if ($line -match '^(ssh-|ecdsa-)') { Write-Option 'file' $line $pub.FullName }
  }
  Say ("option`tgenerate`t-`tssh-ed25519`ta new key for Beanstalk`t{0}" -f (Join-Path $HOME '.ssh/beanstalk_ed25519'))
}

function Invoke-Generate {
  $path = if ($File) { $File } else { Join-Path $HOME '.ssh/beanstalk_ed25519' }
  if (Test-Path $path) { Fail "$path already exists; register it with: register -Key $path.pub" }
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $config = Get-SetupConfig
  # No passphrase (a script cannot type one); add one later with: ssh-keygen -p -f <file>
  & ssh-keygen -q -t ed25519 -N $EmptyArg -C "beanstalk $(Get-MachineName) $($config.Host)" -f $path
  if ($LASTEXITCODE -ne 0) { Fail 'ssh-keygen failed' }
  Say "generated: $path.pub"
  Say "fingerprint: $(Get-Fingerprint (Get-Content "$path.pub" -TotalCount 1))"
  Say "passphrase: none (to add one: ssh-keygen -p -f $path)"
}

function Get-BrowserOpener {
  if ($env:BEANSTALK_NO_BROWSER -eq '1') { return $null }
  if ($env:BROWSER) { return $env:BROWSER }
  if ($IsWin) { return 'start' }
  foreach ($opener in 'open', 'xdg-open', 'wslview') { if (Get-Command $opener -ErrorAction SilentlyContinue) { return $opener } }
  return $null
}

function Test-Headless {
  if ($env:SSH_CONNECTION) { return $true }
  if ((Get-Platform) -eq 'linux' -and -not ($env:DISPLAY -or $env:WAYLAND_DISPLAY)) { return $true }
  return $false
}

function Open-Url([string]$Url) {
  $opener = Get-BrowserOpener
  if (-not $opener -or (Test-Headless)) { return $false }
  if ($opener -eq 'start') { Start-Process $Url } else { & $opener $Url *> $null }
  return $true
}

function Get-KeyLine {
  if ($Key) {
    if (-not (Test-Path $Key)) { Fail "no public key at $Key" }
    return (Get-Content $Key -TotalCount 1)
  }
  $socket = if ($Agent) { $Agent } else { $env:SSH_AUTH_SOCK }
  foreach ($line in Get-AgentLines $socket) { if ((Get-Fingerprint $line) -eq $AgentKey) { return $line } }
  return $null
}

function Invoke-Register {
  if (-not $Key -and -not $AgentKey) { Fail 'register: pass -Key <file.pub> or -AgentKey <fingerprint>' }
  $line = Get-KeyLine
  if (-not $line) { Fail 'that key was not found (is the agent unlocked?)' }
  if ($line -match 'PRIVATE') { Fail 'that is a private key; pass the .pub file' }
  $config = Get-SetupConfig
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  Set-Content -Path (Join-Path $ConfigDir 'key.pub') -Value $line
  if ($AgentKey) { Set-Content -Path (Join-Path $ConfigDir 'agent') -Value $(if ($Agent) { $Agent } else { $env:SSH_AUTH_SOCK }) }
  $body = @{ public_key = $line; machine = (Get-MachineName); https_token = (-not $config.SshHost) } | ConvertTo-Json -Compress
  try { $answer = Invoke-RestMethod -Method Post -Uri "$Web/api/ssh-keys/request" -ContentType 'application/json' -Body $body -TimeoutSec 20 }
  catch { Fail "Beanstalk refused the key: $($_.ErrorDetails.Message)" }
  Say "fingerprint: $($answer.fingerprint)"
  Say "code: $($answer.user_code)"
  if (-not $NoBrowser -and (Open-Url $answer.verification_uri_complete)) {
    Say "approve: opened $($answer.verification_uri_complete) in your browser (check the code and fingerprint match, then Add key)"
  } else {
    Say "approve: on any signed-in device, open $($answer.verification_uri) and enter $($answer.user_code)"
  }
  Wait-Approval $answer $config
}

function Wait-Approval($Answer, $Config) {
  $deadline = (Get-Date).AddSeconds([int]$Answer.expires_in)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds ([int]$Answer.interval)
    try { $poll = Invoke-RestMethod -Method Post -Uri "$Web/api/ssh-keys/poll" -ContentType 'application/json' -Body (@{ poll_token = $Answer.poll_token } | ConvertTo-Json -Compress) -TimeoutSec 20 } catch { continue }
    switch ($poll.status) {
      'pending' { }
      'approved' {
        Say "approved: key added to @$($poll.handle)"
        if ($poll.https_token) { Save-Token $Config $poll.handle $poll.https_token }
        return
      }
      'denied' { Fail 'the key was declined in the browser; nothing was added' }
      default { Fail 'the request expired; run register again' }
    }
  }
  Fail 'no approval in time; run register again'
}

function Save-Token($Config, [string]$Handle, [string]$Token) {
  $origin = "$($Config.Proto)://$($Config.Host)/"
  $helper = $env:BEANSTALK_CREDENTIAL_HELPER
  if (-not $helper -and -not (& git config --get-urlmatch credential.helper $origin 2>$null)) { $helper = Get-OsCredentialHelper }
  if ($helper) {
    # Scoped to the Beanstalk host: the empty value first clears inherited helpers there.
    & git config --global --unset-all "credential.$origin.helper" 2>$null
    & git config --global --add "credential.$origin.helper" $EmptyArg
    & git config --global --add "credential.$origin.helper" $helper
  }
  "protocol=$($Config.Proto)`nhost=$($Config.Host)`n`n" | & git credential reject
  "protocol=$($Config.Proto)`nhost=$($Config.Host)`nusername=$Handle`npassword=$Token`n`n" | & git credential approve
  if ($LASTEXITCODE -ne 0) { Fail 'git could not store the token' }
  Say "https_token: stored by git's credential helper ($(& git config --get-urlmatch credential.helper $origin))"
}

function Get-OsCredentialHelper {
  if ($IsWin) { & git credential-manager --version *> $null; if ($LASTEXITCODE -eq 0) { return 'manager' } }
  if ($IsMacOS) { return 'osxkeychain' }
  return 'store'
}

function Get-RepoUrl($Config, [string]$Name) {
  if ($Config.SshHost) { return "ssh://git@$($Config.SshHost)/$Name.git" }
  return "$($Config.Origin)/git/$Name.git"
}

function Invoke-Remote {
  if ($Repo -notmatch '^[^/]+/[^/]+$') { Fail 'remote: pass OWNER/REPO' }
  $config = Get-SetupConfig
  $url = Get-RepoUrl $config $Repo
  $env:GIT_TERMINAL_PROMPT = '0'
  & git rev-parse --git-dir *> $null
  if (-not $Dir -and $LASTEXITCODE -eq 0) {
    & git remote set-url origin $url 2>$null
    if ($LASTEXITCODE -ne 0) { & git remote add origin $url }
    Say "remote: origin is $url"
  } else {
    if ($Dir) { & git clone -q $url $Dir } else { & git clone -q $url }
    if ($LASTEXITCODE -ne 0) { Fail 'clone failed: run verify to see why' }
    Say "cloned: $url into $(if ($Dir) { $Dir } else { ($Repo -split '/')[1] })"
  }
  if (-not $config.SshHost) { Say 'transport: HTTPS with your token (git over SSH is not live yet; setup switches remotes once it is)' }
}

function Invoke-Verify {
  $config = Get-SetupConfig
  $env:GIT_TERMINAL_PROMPT = '0'
  $creds = "protocol=$($config.Proto)`nhost=$($config.Host)`n`n" | & git credential fill 2>$null
  $token = ($creds | Where-Object { $_ -like 'password=*' } | Select-Object -First 1) -replace '^password=', ''
  if (-not $token) { Fail "git has no credential for $($config.Host) yet: run register" }
  $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x:$token"))
  try { $whoami = Invoke-RestMethod -Uri "$($config.Origin)/v1/whoami" -Headers @{ Authorization = "Basic $basic" } -TimeoutSec 20 }
  catch { Fail 'the gateway refused the stored credential: run register again' }
  Say "whoami: @$($whoami.handle)"
  if ($Repo) {
    & git ls-remote (Get-RepoUrl $config $Repo) *> $null
    if ($LASTEXITCODE -ne 0) { Fail "git ls-remote $Repo failed" }
    Say "ls_remote: $Repo ok"
  }
}

switch ($Command) {
  'detect' { Invoke-Detect }
  'generate' { Invoke-Generate }
  'register' { Invoke-Register }
  'remote' { Invoke-Remote }
  'verify' { Invoke-Verify }
  default { [Console]::Error.WriteLine('usage: beanstalk-setup.ps1 detect | generate | register | remote OWNER/REPO [DIR] | verify [OWNER/REPO]'); exit 2 }
}
