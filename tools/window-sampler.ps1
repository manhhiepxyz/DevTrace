# =====================================================================
#  tools/window-sampler.ps1 — Đo thời gian tập trung (tuỳ chọn).
#
#  Windows không cho biết ứng dụng nào đang ở tiền cảnh trừ khi có tiến
#  trình chủ động hỏi. DevTrace cố tình KHÔNG tự cài đặt gì vào máy huynh.
#  Khi nào muốn đo, huynh tự chạy script này:
#
#      powershell -ExecutionPolicy Bypass -File tools\window-sampler.ps1
#
#  Script ghi nối vào data/window-log.jsonl. Bấm Ctrl + C để dừng — khối
#  đang chạy vẫn được ghi lại trước khi thoát.
#
#  Kiểm tra lại phép tính mà không cần đo thật:
#
#      powershell -ExecutionPolicy Bypass -File tools\window-sampler.ps1 -SelfTest
# =====================================================================

param(
  [int]$IntervalSeconds = 20,
  [int]$IdleSeconds = 120,
  [int]$MinSeconds = 5,
  [string]$OutFile = "",
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# =====================================================================
#  Phần tính toán. Tách hẳn khỏi phần hỏi Windows để kiểm thử được —
#  đây chính là chỗ từng cộng dồn bậc hai và báo một giờ thành 89 giờ.
# =====================================================================

function New-SamplerState {
  return [pscustomobject]@{
    Key = $null; App = $null; Title = $null; Start = $null; Seconds = 0.0
  }
}

# Khoảng vừa trôi chỉ được tính khi huynh còn ngồi trước máy. Ngồi không
# không phải là tập trung, dù cửa sổ vẫn đang mở.
function Get-CreditedSeconds {
  param([double]$DeltaSeconds, [double]$Idle, [int]$IdleThreshold)
  if ($DeltaSeconds -lt 0) { return 0.0 }
  if ($Idle -ge $IdleThreshold) { return 0.0 }
  return $DeltaSeconds
}

# Nhận một mẫu, cập nhật trạng thái, trả về khối vừa kết thúc (hoặc $null).
# Khoảng vừa trôi thuộc về cửa sổ đã hiện suốt khoảng đó — tức khối CŨ.
function Step-Sampler {
  param($State, [string]$Key, [string]$App, [string]$Title, [datetime]$At, [double]$Credit)

  $finished = $null
  if ($null -ne $State.Key -and $Key -ne $State.Key) {
    $State.Seconds += $Credit
    $finished = [pscustomobject]@{
      App = $State.App; Title = $State.Title; Start = $State.Start; Seconds = $State.Seconds
    }
    $State.Key = $null
  }

  if ($null -eq $State.Key) {
    $State.Key = $Key
    $State.App = $App
    $State.Title = $Title
    $State.Start = $At
    $State.Seconds = 0.0
  } else {
    $State.Seconds += $Credit
  }

  return $finished
}

# Khép khối đang chạy lúc thoát.
function Stop-Sampler {
  param($State)
  if ($null -eq $State.Key) { return $null }
  return [pscustomobject]@{
    App = $State.App; Title = $State.Title; Start = $State.Start; Seconds = $State.Seconds
  }
}

function Write-Record {
  param($Segment, [string]$Path, [int]$MinSeconds)
  if ($null -eq $Segment) { return }
  if ($Segment.Seconds -lt $MinSeconds) { return }

  $record = [ordered]@{
    ts      = ([DateTimeOffset]$Segment.Start).ToUnixTimeMilliseconds()
    app     = $Segment.App
    title   = $Segment.Title
    seconds = [int][math]::Round($Segment.Seconds)
  }

  # Ghi thẳng bằng .NET thay vì Add-Content -Encoding UTF8: Windows
  # PowerShell 5.1 chèn BOM vào đầu tệp mới, và BOM làm hỏng dòng JSONL
  # đầu tiên đối với mọi trình đọc không phải của DevTrace.
  $line = ($record | ConvertTo-Json -Compress) + "`n"
  [System.IO.File]::AppendAllText($Path, $line, $script:Utf8NoBom)
}

function Invoke-SelfTest {
  $failed = 0
  $base = Get-Date '2026-01-01 09:00:00'

  # Bốn mẫu cách nhau 20 giây, cùng một cửa sổ: đúng 60 giây. Bản cũ cho 120.
  $state = New-SamplerState
  $segments = @()
  for ($i = 0; $i -lt 4; $i++) {
    $done = Step-Sampler -State $state -Key 'Code|a.js' -App 'Code' -Title 'a.js' -At $base.AddSeconds($i * 20) -Credit 20
    if ($done) { $segments += $done }
  }
  $segments += Stop-Sampler -State $state
  $total = 0.0
  foreach ($s in $segments) { if ($s) { $total += $s.Seconds } }
  if ([math]::Abs($total - 60) -lt 0.001) {
    Write-Host '  ok   4 mẫu cùng cửa sổ => 60 giây'
  } else {
    $failed++
    Write-Host "  FAIL 4 mẫu cùng cửa sổ => $total giây, mong đợi 60"
  }

  # Một giờ tập trung liên tục: đúng 3600 giây. Bản cũ cho 322200.
  $state = New-SamplerState
  for ($i = 0; $i -lt 181; $i++) {
    [void](Step-Sampler -State $state -Key 'Code|a.js' -App 'Code' -Title 'a.js' -At $base.AddSeconds($i * 20) -Credit 20)
  }
  $hour = (Stop-Sampler -State $state).Seconds
  if ([math]::Abs($hour - 3600) -lt 0.001) {
    Write-Host '  ok   1 giờ tập trung liên tục => 3600 giây'
  } else {
    $failed++
    Write-Host "  FAIL 1 giờ tập trung liên tục => $hour giây, mong đợi 3600"
  }

  # Đổi cửa sổ: khối cũ khép lại với đúng thời gian của nó, không rò sang
  # khối mới.
  $state = New-SamplerState
  [void](Step-Sampler -State $state -Key 'A|x' -App 'A' -Title 'x' -At $base -Credit 20)
  [void](Step-Sampler -State $state -Key 'A|x' -App 'A' -Title 'x' -At $base.AddSeconds(20) -Credit 20)
  $switched = Step-Sampler -State $state -Key 'B|y' -App 'B' -Title 'y' -At $base.AddSeconds(40) -Credit 20
  if ($switched -and [math]::Abs($switched.Seconds - 40) -lt 0.001) {
    Write-Host '  ok   đổi cửa sổ thì khép đúng khối cũ (40 giây)'
  } else {
    $got = if ($switched) { $switched.Seconds } else { 'không khép' }
    $failed++
    Write-Host "  FAIL đổi cửa sổ => $got, mong đợi 40"
  }

  # Đổi cửa sổ rồi khối mới bắt đầu lại từ 0.
  $after = (Stop-Sampler -State $state).Seconds
  if ([math]::Abs($after - 0) -lt 0.001) {
    Write-Host '  ok   khối mới bắt đầu lại từ 0'
  } else {
    $failed++
    Write-Host "  FAIL khối mới => $after giây, mong đợi 0"
  }

  # Ngồi không quá ngưỡng thì không tính giờ.
  $idleCredit = Get-CreditedSeconds -DeltaSeconds 20 -Idle 600 -IdleThreshold 120
  $awakeCredit = Get-CreditedSeconds -DeltaSeconds 20 -Idle 10 -IdleThreshold 120
  if ($idleCredit -eq 0 -and $awakeCredit -eq 20) {
    Write-Host '  ok   ngồi không => 0 giây, còn ngồi làm => 20 giây'
  } else {
    $failed++
    Write-Host "  FAIL ngồi không => $idleCredit, ngồi làm => $awakeCredit"
  }

  return $failed
}

if ($SelfTest) {
  Write-Host 'Kiểm tra phép tính của bộ lấy mẫu:'
  $failed = Invoke-SelfTest
  Write-Host ''
  if ($failed -gt 0) {
    Write-Host "$failed kiểm tra không đạt."
    exit 1
  }
  Write-Host 'Tất cả kiểm tra đều đạt.'
  exit 0
}

# =====================================================================
#  Phần hỏi Windows.
# =====================================================================

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutFile) { $OutFile = Join-Path $root "data\window-log.jsonl" }
$outDir = Split-Path -Parent $OutFile
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

if (-not ("Win32Focus" -as [type])) {
  Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public struct LASTINPUTINFO {
  public uint cbSize;
  public uint dwTime;
}

public class Win32Focus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
}
"@
}

function Get-ForegroundInfo {
  $handle = [Win32Focus]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return $null }

  $buffer = New-Object System.Text.StringBuilder 512
  [void][Win32Focus]::GetWindowText($handle, $buffer, $buffer.Capacity)

  # Biến đặt tên $procId chứ KHÔNG phải $pid: $PID là biến tự động chỉ-đọc
  # của PowerShell. Gán vào nó là ném lỗi, và vì $ErrorActionPreference đặt
  # là Stop nên lỗi đó giết cả script ngay mẫu đầu tiên.
  [uint32]$procId = 0
  [void][Win32Focus]::GetWindowThreadProcessId($handle, [ref]$procId)

  $name = ""
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = "pid:$procId" }
  return [pscustomobject]@{ App = $name; Title = $buffer.ToString() }
}

function Get-IdleSeconds {
  $info = New-Object LASTINPUTINFO
  # sizeof(LASTINPUTINFO) = 2 x uint32. Cấu trúc Win32 cố định, không đổi.
  $info.cbSize = 8
  if (-not [Win32Focus]::GetLastInputInfo([ref]$info)) { return 0.0 }

  $idleMs = [uint32](([uint32][Environment]::TickCount) - $info.dwTime)
  # TickCount quay vòng sau khoảng 24,9 ngày; giá trị vô lý thì coi như
  # không rõ và đừng trừ oan thời gian của huynh.
  if ($idleMs -gt 2147483647) { return 0.0 }
  return $idleMs / 1000.0
}

Write-Host "DevTrace đang đo cửa sổ tiền cảnh mỗi $IntervalSeconds giây."
Write-Host "Ghi vào: $OutFile"
Write-Host "Bấm Ctrl + C để dừng."

$state = New-SamplerState
$lastTick = Get-Date

try {
  while ($true) {
    Start-Sleep -Seconds $IntervalSeconds
    $now = Get-Date
    $delta = ($now - $lastTick).TotalSeconds
    $lastTick = $now

    $info = Get-ForegroundInfo
    if (-not $info) { continue }

    $credit = Get-CreditedSeconds -DeltaSeconds $delta -Idle (Get-IdleSeconds) -IdleThreshold $IdleSeconds
    $key = "$($info.App)|$($info.Title)"
    $finished = Step-Sampler -State $state -Key $key -App $info.App -Title $info.Title -At $now -Credit $credit
    if ($finished) { Write-Record -Segment $finished -Path $OutFile -MinSeconds $MinSeconds }
  }
} finally {
  # Ctrl + C cắt vòng lặp, nhưng khối đang chạy — thường là phiên tập trung
  # dài nhất trong ngày, cũng là thứ đáng ghi nhất — vẫn phải được ghi lại.
  Write-Record -Segment (Stop-Sampler -State $state) -Path $OutFile -MinSeconds $MinSeconds
}
