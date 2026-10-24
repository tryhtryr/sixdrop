Add-Type -AssemblyName System.Windows.Forms, Microsoft.VisualBasic
$edge = (Get-Process msedge | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).Id
[Microsoft.VisualBasic.Interaction]::AppActivate($edge) | Out-Null
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('https://zhanzhang.sogou.com/index.php/site/add')
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Seconds 7
