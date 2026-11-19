param(
    [ValidateSet('Start','StartManual','Open','Install','Status')][string]$Action='Start',
    [string]$Config=(Join-Path $PSScriptRoot 'prism-launch.json'),
    [string]$DshEntry,
    [ValidateRange(1024,65535)][int]$Port=33833,
    [ValidateRange(0,65535)][int]$ProxyPort=0
)
$ErrorActionPreference='Stop'
function Test-ListeningPort([int]$PortNumber){
    $network=[Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties()
    return [bool]($network.GetActiveTcpListeners() | Where-Object Port -eq $PortNumber | Select-Object -First 1)
}
if(!(Test-Path -LiteralPath $Config -PathType Leaf)){
    if($Action -ne 'Install'){throw 'Run INSTALL-PRISM.cmd once before starting.'}
    if($Port -in 33825,33826,33829,33831){throw 'Choose an unused port for the new isolated installation.'}
    if(Test-ListeningPort $Port){throw 'This port is already in use. Choose an unused port with -Port.'}
    $from=Split-Path -Parent ([IO.Path]::GetFullPath($Config))
    $packages=@(Get-ChildItem -LiteralPath $from -Filter 'prism-local-workbench-*.tgz' -File)
    if($packages.Count -ne 1){throw 'Keep exactly one PRISM .tgz next to INSTALL-PRISM.cmd for first-time setup.'}
    $data=Join-Path $from 'PRISM-data'
    if(Test-Path -LiteralPath $data){throw 'PRISM-data already exists. Use its original launch config or choose an empty installation folder.'}
    if(!$DshEntry){
        $shim=Get-Command dsh.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
        if($shim){
            $candidate=Join-Path (Split-Path -Parent $shim.Source) 'node_modules/@deepseek-ai/dsh/lib/bin.js'
            if(Test-Path -LiteralPath $candidate -PathType Leaf){$DshEntry=$candidate}
        }
    }
    if(!$DshEntry){$DshEntry=Read-Host 'Full path to the installed official DSH lib/bin.js'}
    $entry=(Resolve-Path -LiteralPath $DshEntry.Trim().Trim('"')).ProviderPath
    $manifest=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path (Split-Path -Parent $entry) '../package.json') | ConvertFrom-Json
    if((Split-Path -Leaf $entry) -ne 'bin.js' -or $manifest.name -ne '@deepseek-ai/dsh' -or $manifest.version -ne '0.2.2-rc.1'){
        throw 'Select the installed official DeepSeek Harness 0.2.2-rc.1 lib/bin.js.'
    }
    $nodeVersion=& node.exe --version
    if($LASTEXITCODE -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24){throw 'Node.js 24 or later must be available in PATH.'}
    $homeDir=Join-Path $data 'dsh-home'
    New-Item -ItemType Directory -Path $homeDir | Out-Null
    $env:DSH_HOME=$homeDir
    & node.exe $entry --profile web --dump-config *> $null
    if($LASTEXITCODE){throw 'Could not initialize the isolated official DSH Web profile.'}
    $namespace=[guid]::NewGuid().ToString()
    $origin="http://127.0.0.1:$Port"
    $journal=(Join-Path $data 'model-journal').Replace('\','/') | ConvertTo-Json -Compress
    $recovery=(Join-Path $data 'workspace-recovery').Replace('\','/') | ConvertTo-Json -Compress
    $patchText=@"
- id: prism-local-workbench
  name: prism-local-workbench
  disabled: false
  config:
    storageNamespace: '$namespace'
    accountModel:
      origin: '$origin'
      journal: $journal
    workspaceRecovery:
      origin: '$origin'
      directory: $recovery
"@
    $sample=Join-Path $from 'examples/riparian-thinning.pdf'
    if(Test-Path -LiteralPath $sample -PathType Leaf){
        $algorithm=[Security.Cryptography.SHA256]::Create()
        $stream=[IO.File]::OpenRead($sample)
        try{$digest=([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
        finally{$stream.Dispose();$algorithm.Dispose()}
        if($digest -eq '70476bc876edbaf72b140abff3ec7578000986ddc352dfb06f18ae05504e6b95'){
            $samplePath=$sample.Replace('\','/') | ConvertTo-Json -Compress
            $patchText+="`n"+@"
    localReferencePdf:
      origin: '$origin'
      filename: $samplePath
      sha256: '$digest'
"@
        }else{Write-Warning 'The example PDF did not match its checksum. Import a trusted PDF with the normal file picker.'}
    }
    [IO.File]::WriteAllText((Join-Path $homeDir 'profiles/web/cordis.patch.yml'),$patchText+"`n")
    $configuredProxy=if($ProxyPort){$ProxyPort}else{$null}
    $launch=[ordered]@{dshEntry=$entry;isolatedHome=$homeDir;packagePath=$packages[0].Name;port=$Port;proxyPort=$configuredProxy}
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($Config),($launch | ConvertTo-Json)+"`n")
}
$c=Get-Content -Raw -Encoding UTF8 -LiteralPath $Config | ConvertFrom-Json
$entry=(Resolve-Path -LiteralPath $c.dshEntry -ErrorAction Stop).ProviderPath
$isolated=(Resolve-Path -LiteralPath $c.isolatedHome -ErrorAction Stop).ProviderPath
$port=[int]$c.port
if($port -lt 1024 -or $port -gt 65535 -or $port -in 33825,33826){throw 'Choose a dedicated loopback port.'}
$usual=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
if($isolated.Equals($usual,[StringComparison]::OrdinalIgnoreCase) -or $isolated.StartsWith($usual+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a dedicated DSH home.'}
if((Split-Path -Leaf $entry) -ne 'bin.js'){throw 'Choose the official DSH CLI entry.'}
$profile=Join-Path $isolated 'profiles/web'
$patch=Join-Path $profile 'cordis.patch.yml'
$origin="http://127.0.0.1:$port"
if(!(Test-Path -LiteralPath $patch -PathType Leaf) -or (Get-Content -Raw -LiteralPath $patch) -notmatch "(?m)^\s+origin:\s*['""]?$([Regex]::Escape($origin))['""]?\s*$"){
    throw 'The dedicated profile patch must already name this loopback origin.'
}
$live=Test-ListeningPort $port
if($Action -eq 'Status'){Write-Output ([pscustomobject]@{origin=$origin;listening=$live});return}
if($live -and $Action -eq 'Open'){
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port)
    if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'The configured port is occupied by a different listener.'}
    $running=Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
    if(!$running.CommandLine -or $running.CommandLine -notmatch '(?i)bin\.js.*--profile web.*--host 127\.0\.0\.1.*--port '){throw 'The configured port is not a DSH web listener.'}
    Start-Process $origin
    return
}
if($live){throw 'Close the dedicated host console before starting or changing its package.'}
if($Action -eq 'Open'){throw 'The workbench is stopped. Run START-PRISM.cmd.'}
$env:DSH_HOME=$isolated
if($Action -eq 'Install'){
    $from=Split-Path -Parent (Resolve-Path -LiteralPath $Config).Path
    $pkg=if([IO.Path]::IsPathRooted($c.packagePath)){$c.packagePath}else{Join-Path $from $c.packagePath}
    $pkg=(Resolve-Path -LiteralPath $pkg -ErrorAction Stop).ProviderPath
    $backup=Join-Path $from ('rollback-'+(Get-Date -Format yyyyMMdd-HHmmss-fff))
    New-Item -ItemType Directory -Path $backup | Out-Null
    foreach($file in 'cordis.patch.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml'){
        $current=Join-Path $profile $file
        if(Test-Path -LiteralPath $current -PathType Leaf){Copy-Item -LiteralPath $current -Destination $backup}
    }
    $sha=[Security.Cryptography.SHA256]::Create()
    try{
        $hashes=@(Get-ChildItem -LiteralPath $backup -File | ForEach-Object {
            $stream=[IO.File]::OpenRead($_.FullName)
            try{[pscustomobject]@{File=$_.Name;Hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}}finally{$stream.Dispose()}
        })
        [IO.File]::WriteAllText((Join-Path $backup 'SHA256.json'),(ConvertTo-Json -InputObject $hashes)+"`n")
    }finally{$sha.Dispose()}
    & node.exe $entry plugin --profile web add ('file:'+$pkg.Replace('\','/')) --offline --ignore-scripts
    if($LASTEXITCODE){throw "Installation failed; configuration backup: $backup"}
    Write-Output "Installed. Configuration backup: $backup"
    return
}
if($null -ne $c.proxyPort){
    $proxyPort=[int]$c.proxyPort
    if($proxyPort -lt 1024 -or $proxyPort -gt 65535){throw 'Invalid proxy port.'}
    $tcp=[Net.Sockets.TcpClient]::new()
    try{$tcp.Connect([Net.IPAddress]::Loopback,$proxyPort)}finally{$tcp.Dispose()}
    $env:HTTP_PROXY="http://127.0.0.1:$proxyPort"
    $env:HTTPS_PROXY=$env:HTTP_PROXY
    $env:ALL_PROXY=$env:HTTP_PROXY
}
$env:NO_PROXY=(@($env:NO_PROXY -split ',' | ForEach-Object {$_.Trim()})+@('127.0.0.1','localhost')|Where-Object {$_}|Select-Object -Unique) -join ','
Write-Output "Starting the PRISM workbench at $origin. Leave this window open."
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$previousErrorPreference=$ErrorActionPreference
try{
    # Windows PowerShell 5.1 can report redirected native stderr as a PowerShell error.
    # Let the host run until it returns an exit code, including when it prints a warning.
    $ErrorActionPreference='Continue'
    if($Action -eq 'StartManual'){
        # The official command prints the owner URL in this console only.
        & $nodePath $entry --profile web --host 127.0.0.1 --port $port --no-open
    }else{
        # The official launcher opens the owner browser tab. Discard the printed URL.
        & $nodePath $entry --profile web --host 127.0.0.1 --port $port *> $null
    }
    $hostExit=$LASTEXITCODE
}finally{$ErrorActionPreference=$previousErrorPreference}
if($hostExit){throw "DSH exited with code $hostExit. Check the dedicated profile and proxy, then retry."}
