param(
  [int]$Focus = 0,
  [string]$ClipFile = '',
  [string]$ClipText = '',
  [int]$ClickX = -1,
  [int]$ClickY = -1,
  [switch]$CtrlA,
  [switch]$CtrlV,
  [string]$Send = '',
  [string]$Shot = ''
)

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, Microsoft.VisualBasic
Add-Type -Namespace Win32 -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
'@

if ($Focus -gt 0) {
  [Microsoft.VisualBasic.Interaction]::AppActivate($Focus) | Out-Null
  Start-Sleep -Milliseconds 700
}
if ($ClipFile) { $ClipText = [System.IO.File]::ReadAllText($ClipFile, [System.Text.Encoding]::UTF8) }
if ($ClipText) {
  Set-Clipboard -Value $ClipText
  Start-Sleep -Milliseconds 400
}
if ($ClickX -ge 0 -and $ClickY -ge 0) {
  [Win32.Native]::SetCursorPos($ClickX, $ClickY) | Out-Null
  Start-Sleep -Milliseconds 250
  [Win32.Native]::mouse_event(0x02, 0, 0, 0, 0)
  [Win32.Native]::mouse_event(0x04, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 700
}
if ($CtrlA) {
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 300
}
if ($CtrlV) {
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 1500
}
if ($Send) {
  [System.Windows.Forms.SendKeys]::SendWait($Send)
  Start-Sleep -Milliseconds 1200
}
if ($Shot) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "shot: $Shot"
}
