Write-Host "
                      /^\
                      | |
                      |-|
                 /^\  | |
          /^\  / [_] \+-+
         |---||-------| |
_/^\_    _/^\_|  [_]  |_/^\_   _/^\_
|___|    |___||_______||___|   |___|
 | |======| |===========| |=====| |
 | |      | |    /^\    | |     | |
 | |      | |   |   |   | |     | |
 |_|______|_|__ |   |___|_|_____|_|
"


function findAll {
    param($filter,$Searcher)
    $domainObj = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
    $PDC = ($domainObj.PdcRoleOwner).Name
    $SearchString = "LDAP://"
    $SearchString += $PDC + "/"
    $DistinguishedName = "DC=$($domainObj.Name.Replace('.', ',DC='))"
    $SearchString += $DistinguishedName
    $Searcher = New-Object System.DirectoryServices.DirectorySearcher([ADSI]$SearchString)
    $objDomain = New-Object System.DirectoryServices.DirectoryEntry
    $Searcher.SearchRoot = $objDomain
    $Searcher.filter=$filter
    $Result = $Searcher.FindAll()
    return $Result
}


function enum-group ($Result, $match){
    $indent = ""
    foreach($group in $Result.properties) {
        if( !($group.member -eq $null)){
            foreach($member in $group.member) {
                $groupname = $member.split(",")[0].replace("CN=",'')
                if($groupname -eq $match) {
                    Write-Host "Parent:" $group.name " --> " "Child:" $match
                }
            }
        }
    }
}



Write-Host "--------------------------------"
Write-Host "  LIST AD Group RELATIONSHIPS"
Write-Host "--------------------------------"

$Result = findall "(objectClass=Group)" $Searcher

foreach($group in $Result.properties) {
    $match=$group.name
    enum-group -Result $Result -match $match  
}


Write-Host "---------------------------"
Write-Host "    LIST DOMAIN ADMINS"
Write-Host "---------------------------"

$Result = findall "name=Domain Admins" $Searcher

Foreach($obj in $Result){
    Write-host "Usernames:"
    foreach($member in $obj.Properties.member) { 
        $name = $member.split(",")[0].replace("CN=",'')
        
        Write-Host "`t" $name
   
    }
}


Write-Host "---------------------------"
Write-Host "  LIST AD SERVICE ACCOUNTS"
Write-Host "---------------------------"

$Result = findall "serviceprincipalname=*" $Searcher

$dtable = New-Object System.Data.DataTable
$dtable.Columns.Add("Hostname", "System.String") | Out-Null
$dtable.Columns.Add("SPN", "System.String") | Out-Null
$dtable.Columns.Add("Service", "System.String") | Out-Null
$dtable.Columns.Add("DomainName", "System.String") | Out-Null
$dtable.Columns.Add("IPAddress", "System.String") | Out-Null
foreach ($Object in $Result){
    $hostname = $Object.Properties.serviceprincipalname.split("/")[1].split(":")[0]
    $service = $Object.Properties.serviceprincipalname.split("/")[0]
    $spn = $Object.Properties.serviceprincipalname[0]
    $resolv = resolve-dnsname $hostname 2> $null
    $nRow = $dtable.NewRow()
    $nRow.Hostname = $hostname
    $nRow.SPN = $spn
    $nRow.Service = $service
    if ($resolv -eq $null) {
        $nRow.DomainName = ""
        $nRow.IPAddress = ""
    } else {
        $nRow.DomainName = $resolv[0].Name
        $nRow.IPAddress = $resolv[0].IPaddress
    }
    
    $dtable.Rows.Add($nRow)
}
$dtable | Format-List
Write-Host "------------------------------------------------"