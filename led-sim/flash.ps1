# Compiles a sketch for the ESP32 and uploads it, then restarts led-audio.exe feeding the board.
#   flash.ps1 my_design.ino            (finds the ESP32's COM port)
#   flash.ps1 my_design.ino -Port COM5
param(
  [Parameter(Mandatory = $true)][string]$Sketch,
  [string]$Port,
  [string]$Fqbn = 'esp32:esp32:esp32',
  [switch]$NoAudio
)
$ErrorActionPreference = 'Stop'
$root = 'D:\Claude Misc\arduino'
$cli = "$root\arduino-cli.exe"
$cfg = "$root\arduino-cli.yaml"
function Cli { & $cli --config-file $cfg @args; if ($LASTEXITCODE) { throw "arduino-cli $($args[0]) failed" } }

# Arduino wants the .ino inside a folder of the same name.
$src = (Resolve-Path $Sketch).Path
$name = [IO.Path]::GetFileNameWithoutExtension($src) -replace '[^A-Za-z0-9_]', '_'
$dir = Join-Path "$root\sketches" $name
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item $src (Join-Path $dir "$name.ino") -Force
$text = Get-Content $src -Raw
$baud = if ($text -match '#define\s+BAUD\s+(\d+)') { $Matches[1] } elseif ($text -match 'Serial\.begin\((\d+)\)') { $Matches[1] } else { '115200' }

Write-Host "Compiling $name for $Fqbn..." -ForegroundColor Cyan
Cli compile --fqbn $Fqbn $dir

if (-not $Port) {
  $list = & $cli --config-file $cfg board list --format json | ConvertFrom-Json
  $ports = @($list.detected_ports | Where-Object { $_.port.protocol -eq 'serial' } | ForEach-Object { $_.port })
  if ($ports.Count -eq 0) { throw 'No serial port found. Plug in the ESP32 (it needs the CP210x or CH340 USB driver).' }
  if ($ports.Count -eq 1) { $Port = $ports[0].address }
  else {
    Write-Host 'Serial ports:'
    $ports | ForEach-Object { Write-Host "  $($_.address)  $($_.label)  $($_.properties.vid):$($_.properties.pid)" }
    $Port = Read-Host 'Which port is the ESP32 (e.g. COM5)'
  }
}

# led-audio.exe holds the port while feeding the board; free it for the upload.
$audio = Get-Process led-audio -ErrorAction SilentlyContinue
if ($audio) { Write-Host 'Stopping led-audio.exe to free the port...'; $audio | Stop-Process -Force; Start-Sleep -Milliseconds 600 }

Write-Host "Uploading to $Port..." -ForegroundColor Cyan
Cli upload -p $Port --fqbn $Fqbn $dir
Write-Host 'Upload done.' -ForegroundColor Green

if (-not $NoAudio -and $text -match 'readAudio') {
  Write-Host "Starting led-audio.exe --port $Port --baud $baud (new window; it also feeds the simulator)"
  Start-Process (Join-Path $PSScriptRoot 'led-audio.exe') -ArgumentList '--port', $Port, '--baud', $baud
}
