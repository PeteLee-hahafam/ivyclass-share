# 강의 제작 엔진 설치 (학원 PC, 윈도우 10/11)
# 강의실 사이트 > 설정 > 제작 엔진 > '엔진 설치 파일 받기'로 받은 파일이 이걸 실행해요.
param([Parameter(Mandatory = $true)][string]$Origin, [Parameter(Mandatory = $true)][string]$Code)
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Done($code) { Write-Host ''; Read-Host '  엔터를 누르면 창이 닫혀요' | Out-Null; exit $code }

Write-Host ''
Say '강의 제작 엔진을 설치해요. 5~10분쯤 걸려요. 창을 닫지 말고 기다려 주세요.' Green
Write-Host ''

$token = ($Code -split '\.', 3)[2]
if (-not $token) { Say '연결 코드가 올바르지 않아요. 사이트에서 설치 파일을 다시 받아 주세요.' Red; Done 1 }
$headers = @{ Authorization = "Bearer $token" }
$root = Join-Path $env:LOCALAPPDATA 'IvyEngine'
$app = Join-Path $root 'app'

# 0. 이미 켜져 있는 엔진은 잠깐 꺼요
try {
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | Where-Object { $_.CommandLine -like '*ivy_engine*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*run_engine.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

# 1. 파이썬
function Find-Python {
  $cands = New-Object System.Collections.ArrayList
  if (Get-Command py -ErrorAction SilentlyContinue) {
    [void]$cands.Add(@{ exe = 'py'; args = @('-3.12') })
    [void]$cands.Add(@{ exe = 'py'; args = @('-3') })
  }
  if (Get-Command python -ErrorAction SilentlyContinue) { [void]$cands.Add(@{ exe = 'python'; args = @() }) }
  foreach ($p in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe")) {
    if (Test-Path $p) { [void]$cands.Add(@{ exe = $p; args = @() }) }
  }
  foreach ($c in $cands) {
    try {
      $a = $c.args
      $v = & $c.exe @a -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
      if ($LASTEXITCODE -eq 0 -and $v -and ([version]("$v".Trim()) -ge [version]'3.10')) { return $c }
    } catch {}
  }
  return $null
}
$py = Find-Python
if (-not $py) {
  Say '파이썬이 없어서 설치할게요. 확인 창이 뜨면 [예]를 눌러 주세요.' Yellow
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  $py = Find-Python
  if (-not $py) {
    Say '파이썬을 설치하지 못했어요. python.org 에서 Python 3.12를 설치한 뒤 이 파일을 다시 실행해 주세요.' Red
    Say '(설치할 때 "Add python.exe to PATH"에 체크해 주세요.)' Red
    Done 1
  }
}

# 2. 엔진 파일 받기
Say '엔진 파일을 받는 중...'
try {
  $bundle = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri ($Origin.TrimEnd('/') + '/_engine/bundle.json') -TimeoutSec 180
} catch {
  Say "엔진 파일을 받지 못했어요: $($_.Exception.Message)" Red
  Say '인터넷을 확인하고, 사이트에서 설치 파일을 새로 받아 다시 실행해 주세요.' Yellow
  Done 1
}
New-Item -ItemType Directory -Force -Path $app | Out-Null
$n = 0
foreach ($f in $bundle.files.PSObject.Properties) {
  $rel = $f.Name
  if ($rel -notmatch '^[A-Za-z0-9_./-]+$' -or $rel -match '\.\.') { continue }
  $dst = Join-Path $app ($rel -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  [IO.File]::WriteAllBytes($dst, [Convert]::FromBase64String($f.Value))
  $n++
}
Say "엔진 $($bundle.version) 파일 $n개를 받았어요." Gray

# 3. 엔진 전용 환경과 필요한 프로그램
$vpy = Join-Path $app '.venv\Scripts\python.exe'
if (-not (Test-Path $vpy)) {
  Say '엔진 전용 환경을 만드는 중...'
  $pyExe = $py.exe; $pyArgs = $py.args
  & $pyExe @pyArgs -m venv (Join-Path $app '.venv')
  if (-not (Test-Path $vpy)) { Say '환경을 만들지 못했어요.' Red; Done 1 }
}
Say '필요한 프로그램을 받는 중... (처음에는 몇 분 걸려요)'
& $vpy -m pip install --upgrade pip --disable-pip-version-check -q
& $vpy -m pip install -r (Join-Path $app 'requirements.txt') --disable-pip-version-check -q
if ($LASTEXITCODE -ne 0) { Say '프로그램을 받지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.' Red; Done 1 }

# 4. 영상용 브라우저 (보통 Edge가 이미 있어요)
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ }
if (-not $edge -and -not $chrome) {
  Say 'Edge/Chrome이 없어서 영상용 브라우저를 받을게요...'
  & $vpy -m playwright install chromium
}

# 5. 강의실 연결, 자동 시작
Push-Location $app
& $vpy -m ivy_engine --connect $Code --autostart --setup-only
Pop-Location

# 6. 바탕화면 바로가기
try {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Join-Path $desk '강의 제작 엔진.lnk'))
  $lnk.TargetPath = (Join-Path $app 'run_engine.bat')
  $lnk.WorkingDirectory = $app
  $lnk.WindowStyle = 7
  $lnk.IconLocation = (Join-Path $app 'icon.ico')
  $lnk.Description = '학원 강의 제작 엔진'
  $lnk.Save()
  Say "바탕화면에 '강의 제작 엔진' 아이콘을 만들었어요." Gray
} catch { Say '바탕화면 아이콘은 만들지 못했어요.' Yellow }

# 7. 켜기
Start-Process -FilePath (Join-Path $app 'run_engine.bat') -WorkingDirectory $app -WindowStyle Minimized
Write-Host ''
Say '설치가 끝났어요!' Green
Say '잠시 뒤 엔진 설정 화면이 열려요. Claude API 키와 선생님 목소리를 골라 저장해 주세요.' Green
Say '앞으로는 엔진이 스스로 업데이트하고, 컴퓨터를 켜면 저절로 켜져요.' Gray
Done 0
