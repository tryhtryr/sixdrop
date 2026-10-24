Add-Type -AssemblyName System.Windows.Forms, Microsoft.VisualBasic
$edge = (Get-Process msedge | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).Id
[Microsoft.VisualBasic.Interaction]::AppActivate($edge) | Out-Null
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait('{END}')
Start-Sleep -Seconds 2
