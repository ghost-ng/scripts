$groups = [System.Security.Principal.WindowsIdentity]::GetCurrent().Groups | ForEach-Object -Process { Write-Output $_.Translate([System.Security.Principal.NTAccount]) }
$userpath = $env:path
$path_array = $userpath.split(";")

$dtable = New-Object System.Data.DataTable
$dtable.Columns.Add("FolderPath", "System.String") | Out-Null
$dtable.Columns.Add("Access", "System.String") | Out-Null

Write-host "Current Path: "
$path_array

function CheckFolderAccess {
 Param (
        [String]$Folder
       )
  $User = $env:UserName
    if (! $Folder -eq "" ) {
        
      try {
            $permission = (Get-Acl $Folder -ErrorAction Stop).Access | ?{$_.IdentityReference -match $User} | Select IdentityReference,FileSystemRights
          If ($permission){
            $Row = $dtable.NewRow()
            $Row.FolderPath = $Folder
            $Row.Access = $permission.FileSystemRights
            $dtable.Rows.Add($Row)
          } elseif (! $permission) {
                $Row = $dtable.NewRow()
            $Row.FolderPath = $Folder
                $Row.Access = "NoWriteAccess"
                $dtable.Rows.Add($Row)
            }
        }
        catch {
            $Row = $dtable.NewRow()
        $Row.FolderPath = $Folder
            $Row.Access = "FolderDoesNotExist"
            $dtable.Rows.Add($Row)
        }
    
    }
}
foreach ($p in $path_array) {
    CheckFolderAccess $p
}
$dtable | Format-Table