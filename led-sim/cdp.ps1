# Dev helper: drive headless Edge over the DevTools protocol so the simulator can be
# checked in real time (workers, timers, clicks) rather than at page-load.
#   .\cdp.ps1 -Page 'index.html#example=0' -Actions 'wait:3000','eval:document.title','shot:C:\tmp\a.png'
#   -Page may also be a full URL, e.g. the live site https://trolanin.github.io/led-sim/designer.html
param(
  [string]$Page = 'index.html',
  [string[]]$Actions = @('wait:2000', 'eval:document.title'),
  [int]$Port = 9333, [int]$W = 1440, [int]$H = 1000,
  [switch]$Mobile   # emulate a phone: W x H viewport (e.g. -W 390 -H 844), touch, coarse pointer
)
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$url = if ($Page -match '^https?://') { $Page } else { 'file:///' + ($PSScriptRoot -replace '\\', '/') + '/' + $Page }
$proc = Start-Process -FilePath $edge -PassThru -ArgumentList '--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  "--remote-debugging-port=$Port", '--remote-allow-origins=*', "--user-data-dir=$env:TEMP\ledsim-edge-cdp", "--window-size=$W,$H", 'about:blank'
try {
  $target = $null
  foreach ($i in 1..40) {
    try { $target = (Invoke-RestMethod "http://127.0.0.1:$Port/json") | Where-Object { $_.type -eq 'page' } | Select-Object -First 1 } catch { }
    if ($target) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $target) { throw 'DevTools endpoint did not come up' }
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $script:id = 0
  function Invoke-Cdp([string]$method, $params = @{}) {
    $script:id++
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress))
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, [Threading.CancellationToken]::None).Wait()
    $buf = [byte[]]::new(1MB)
    while ($true) {
      $ms = [IO.MemoryStream]::new()
      do {
        $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).Result
        $ms.Write($buf, 0, $r.Count)
      } until ($r.EndOfMessage)
      $msg = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
      if ($msg.id -eq $script:id) { return $msg.result }
    }
  }
  Invoke-Cdp 'Page.enable' | Out-Null
  if ($Mobile) {
    Invoke-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = $W; height = $H; deviceScaleFactor = 2; mobile = $true } | Out-Null
    Invoke-Cdp 'Emulation.setTouchEmulationEnabled' @{ enabled = $true; maxTouchPoints = 5 } | Out-Null
    Invoke-Cdp 'Emulation.setUserAgentOverride' @{ userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' } | Out-Null
  }
  Invoke-Cdp 'Page.navigate' @{ url = $url } | Out-Null
  Start-Sleep -Milliseconds 800
  foreach ($a in $Actions) {
    $kind, $arg = $a -split ':', 2
    switch ($kind) {
      'wait' { Start-Sleep -Milliseconds ([int]$arg) }
      'eval' {
        $r = Invoke-Cdp 'Runtime.evaluate' @{ expression = $arg; returnByValue = $true; awaitPromise = $true }
        if ($r.exceptionDetails) { "EXCEPTION: $($r.exceptionDetails.exception.description)" } else { "$($r.result.value)" }
      }
      'shot' {
        $r = Invoke-Cdp 'Page.captureScreenshot' @{ format = 'png' }
        [IO.File]::WriteAllBytes($arg, [Convert]::FromBase64String($r.data))
        "saved $arg"
      }
    }
  }
} finally {
  # Edge's launcher process exits early, so close the real browser over the protocol
  # (otherwise the next run would silently attach to this stale instance).
  try { if ($ws -and $ws.State -eq 'Open') { Invoke-Cdp 'Browser.close' | Out-Null } } catch { }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
}
