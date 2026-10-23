# 강의 제작 엔진 설치 (학원 PC, 윈도우 10/11) — 압축 파일로 받은 경우에 써요. 보통은 사이트의 설치 파일을 쓰세요.
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location $PSScriptRoot

function Say($m, $c = 'Gray') { Write-Host "  $m" -ForegroundColor $c }
function Done($code) { Write-Host ''; Read-Host '  엔터를 누르면 창이 닫혀요' | Out-Null; exit $code }

Write-Host ''
Say '강의 제작 엔진을 설치해요. 5~10분쯤 걸려요.' Green
Write-Host ''

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

# 1. 파이썬
$py = Find-Python
if (-not $py) {
  Say '파이썬이 없어서 설치할게요. 확인 창이 뜨면 [예]를 눌러 주세요.' Yellow
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  $py = Find-Python
  if (-not $py) {
    Say '파이썬을 설치하지 못했어요. python.org 에서 Python 3.12를 설치한 뒤 다시 실행해 주세요.' Red
    Say '(설치할 때 "Add python.exe to PATH"에 체크해 주세요.)' Red
    Done 1
  }
}
$pyExe = $py.exe; $pyArgs = $py.args
Say ("파이썬: " + $pyExe + ' ' + ($pyArgs -join ' ')) Gray

# 2. 엔진 전용 환경
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  Say '엔진 전용 환경을 만드는 중...'
  & $pyExe @pyArgs -m venv .venv
  if (-not (Test-Path '.venv\Scripts\python.exe')) { Say '환경을 만들지 못했어요.' Red; Done 1 }
}
$vpy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
Say '필요한 프로그램을 받는 중... (조금 걸려요)'
& $vpy -m pip install --upgrade pip --disable-pip-version-check -q
& $vpy -m pip install -r requirements.txt --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Say '프로그램을 받지 못했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.' Red; Done 1 }

# 3. 영상용 브라우저 (보통 Edge가 이미 있어요)
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ }
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ }
if (-not $edge -and -not $chrome) {
  Say 'Edge/Chrome이 없어서 영상용 브라우저를 받을게요...'
  & $vpy -m playwright install chromium
}

# 4. 바탕화면 바로가기
try {
  $desk = [Environment]::GetFolderPath('Desktop')
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Join-Path $desk '강의 제작 엔진.lnk'))
  $lnk.TargetPath = (Join-Path $PSScriptRoot 'run_engine.bat')
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.WindowStyle = 7
  $lnk.IconLocation = (Join-Path $PSScriptRoot 'icon.ico')
  $lnk.Description = '학원 강의 제작 엔진'
  $lnk.Save()
  Say "바탕화면에 '강의 제작 엔진' 아이콘을 만들었어요." Gray
} catch { Say '바탕화면 아이콘은 만들지 못했어요. run_engine.bat 을 직접 실행해도 돼요.' Yellow }

Write-Host ''
Say '설치가 끝났어요!' Green
Say "바탕화면의 '강의 제작 엔진'을 눌러 시작하면 설정 화면이 열려요." Green
Done 0
