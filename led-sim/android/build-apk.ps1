# Builds ..\led-audio.apk (the Android capture app) with the plain SDK tools: no Gradle, no Android Studio.
#   .\build-apk.ps1                       uses D:\Claude Misc\android\sdk and JDK 17
#   .\build-apk.ps1 -Sdk <path> -Jdk <path>
# The signing key lives OUTSIDE the repo (this repo is public). Keep it: Android only installs an
# update over the existing app when it's signed with the same key.
param(
  [string]$Sdk = 'D:\Claude Misc\android\sdk',
  [string]$Jdk = 'C:\Program Files\Java\jdk-17',
  [string]$KeyDir = 'D:\Claude Misc\android',
  [string]$BuildTools = '36.1.0',
  [string]$Platform = 'android-36'
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bt = Join-Path $Sdk "build-tools\$BuildTools"
$jar = Join-Path $Sdk "platforms\$Platform\android.jar"
$env:JAVA_HOME = $Jdk
$env:Path = "$Jdk\bin;$env:Path"
$out = Join-Path $here 'build'
$apk = Join-Path (Split-Path $here) 'led-audio.apk'

function Run($exe, [string[]]$a) {
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($exe)) failed ($LASTEXITCODE)" }
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\gen", "$out\classes", "$out\dex" | Out-Null

# 1. Resources + manifest -> base APK and R.java
Run "$bt\aapt2.exe" @('compile', '--dir', "$here\res", '-o', "$out\res.zip")
Run "$bt\aapt2.exe" @('link', '-I', $jar, '--manifest', "$here\AndroidManifest.xml", '-o', "$out\base.apk",
  '--java', "$out\gen", "$out\res.zip")

# 2. Java -> class files -> classes.dex
$src = @(Get-ChildItem -Recurse "$here\src", "$out\gen" -Filter *.java | ForEach-Object FullName)
Run "$Jdk\bin\javac.exe" (@('-source', '8', '-target', '8', '-Xlint:-options', '-Xlint:deprecation', '-encoding', 'UTF-8',
  '-bootclasspath', $jar, '-d', "$out\classes") + $src)
$classes = @(Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" (@('--release', '--min-api', '29', '--lib', $jar, '--output', "$out\dex") + $classes)

# 3. Add classes.dex (existing entries are copied untouched, so resources.arsc stays stored)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::Open("$out\base.apk", 'Update')
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, "$out\dex\classes.dex", 'classes.dex') | Out-Null }
finally { $z.Dispose() }

# 4. Align and sign
Run "$bt\zipalign.exe" @('-f', '-p', '4', "$out\base.apk", "$out\aligned.apk")
$ks = Join-Path $KeyDir 'led-audio-release.jks'
$pwFile = Join-Path $KeyDir 'led-audio-release.password.txt'
if (-not (Test-Path $ks)) {
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Set-Content -NoNewline -Path $pwFile -Value $pw
  Run "$Jdk\bin\keytool.exe" @('-genkeypair', '-keystore', $ks, '-alias', 'ledaudio', '-keyalg', 'RSA', '-keysize', '3072',
    '-validity', '10000', '-storepass', $pw, '-keypass', $pw, '-dname', 'CN=LED Audio')
  Write-Host "Created signing key $ks (password in $pwFile). Back these up."
}
$pw = (Get-Content -Raw $pwFile).Trim()
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-key-alias', 'ledaudio', '--ks-pass', "pass:$pw", '--key-pass', "pass:$pw",
  '--out', $apk, "$out\aligned.apk")
Run "$bt\apksigner.bat" @('verify', $apk)
Remove-Item -Force "$apk.idsig" -ErrorAction SilentlyContinue
Write-Host ("Built {0} ({1:N0} KB)" -f $apk, ((Get-Item $apk).Length / 1KB))
