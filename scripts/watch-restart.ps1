# Silent watcher to restart `npm run dev` when source files change
# Writes minimal logs to temp file; runs dev via cmd wrapper to ensure compatibility

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$logFile = Join-Path $env:TEMP 'watch-restart.log'
$pidFile = Join-Path $env:TEMP 'watch-restart.pid'

# debounce settings
$script:debounceMs = 500
$script:last = Get-Date

function Log($m) {
    try { $ts = (Get-Date).ToString('o'); $m | Out-File -FilePath $logFile -Append -Encoding utf8; "$ts $m" | Out-File -FilePath $logFile -Append -Encoding utf8 } catch {}
}

function Start-Dev {
    if ($global:devProc -and -not $global:devProc.HasExited) {
        try { Stop-Process -Id $global:devProc.Id -Force -ErrorAction SilentlyContinue } catch {}
        Start-Sleep -Milliseconds 200
    }
    $cmd = "/c cd /d `"$projectRoot`" && npm run dev *>> `"$logFile`" 2>&1"
    try {
        $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        $global:devProc = $p
        try { $p.Id | Out-File -FilePath $pidFile -Encoding ascii } catch {}
        Log("Started dev pid=$($p.Id)")
    } catch {
        Log("Start-Dev failed: $($_.Exception.Message)")
    }
}

# create FileSystemWatcher for project
$fsw = New-Object System.IO.FileSystemWatcher $projectRoot, "*.*"
$fsw.IncludeSubdirectories = $true
$fsw.EnableRaisingEvents = $true

$action = {
    $path = $Event.SourceEventArgs.FullPath
    $now = Get-Date
    if ((New-TimeSpan $script:last $now).TotalMilliseconds -lt $script:debounceMs) { $script:last = $now; return }
    $script:last = $now
    Log("Change detected: $path")
    if ($global:devProc -and -not $global:devProc.HasExited) {
        try { Stop-Process -Id $global:devProc.Id -Force -ErrorAction SilentlyContinue; Log("Stopped dev pid=$($global:devProc.Id)") } catch { Log("Stop failed: $($_.Exception.Message)") }
    }
    Start-Sleep -Milliseconds 200
    Start-Dev
}

Register-ObjectEvent $fsw Changed -Action $action | Out-Null
Register-ObjectEvent $fsw Created -Action $action | Out-Null
Register-ObjectEvent $fsw Deleted -Action $action | Out-Null
Register-ObjectEvent $fsw Renamed -Action $action | Out-Null

# initial start
Start-Dev
Log("Watcher started monitoring $projectRoot")

# keep script alive
while ($true) { Start-Sleep -Seconds 1 }
