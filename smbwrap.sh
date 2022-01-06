#!/bin/bash


function print_cmd {
	echo -e "${BLUE}[*] Command: $1${NC}" | tee -a $savefile
}

function print_banner {
echo -e "${GREEN}
   __     ________  _________  _    _______  ___  ______    __   
  / /    /  ___|  \/  || ___ \| |  | | ___ \/ _ \ | ___ \   \ \  
 / /_____\ \`--.| .  . || |_/ /| |  | | |_/ / /_\ \| |_/ /____\ \ 
< <______|\`--. \ |\/| || ___ \| |/\| |    /|  _  ||  __/______> >
 \ \     /\__/ / |  | || |_/ /\  /\  / |\ \| | | || |        / / 
  \_\    \____/\_|  |_/\____/  \/  \/\_| \_\_| |_/\_|       /_/  
${NC}"
echo -e "${GREEN}                            ((\o/))
                       .-----//^\\-----.
                       |    /\`| |\`\    |
                       |      | |      |
                       |      | |      |
                       |      | |      |
                       '------===------'

             ${WHITE}wrapped with love by unkn0wnsyst3m
                  ${TEAL}https://mfnttps.github.io/
               ${TEAL}https://github.com/unkn0wnsyst3m/
${NC}"

}


function help_menu {
    echo -e "usage: 
    $0 -t <target> -p <port> [-n [nocolors]]
    $0 -t <target> -p <port> [-U] <username> [-P] <password>
    ${RED}Mandatory: -t <target>${NC}"
    print_banner

    exit 1
}

if [ $# -eq 0 ]; then
    help_menu
fi




username=""
password=""
target=""
port="445"
nocolors=false

unset OPTIND
unset OPTARG
OPTARG=""

while getopts ":U:P:p:t:nh" flag
do
    case $flag in
        
        U) username=$OPTARG
            ;;
        P) password=$OPTARG
            ;;
        p) port=$OPTARG
            ;;
        t) target=$OPTARG
            ;;
        n) nocolors=true
            ;;
        h) help_menu
            ;;
        ?) help_menu
            ;;

    esac
    
done

if [[ $target = "" ]]; then
    help_menu
fi

if [[ $nocolors = true ]] 
then
    RED='\033[0m'
    GREEN='\033[0m'
    NC='\033[0m'
    BLUE='\033[0m'
    TEAL='\033[0m'
    WHITE='\033[0m'
else
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    NC='\033[0m'
    BLUE='\033[0;34m'
    TEAL='\033[0;36m'
    WHITE='\033[0;0m'
fi

savefile="$target.wrap"

print_banner
echo -e "${RED}
 ===================================
|         Target Information        |
 ===================================
  Target ......... $target
  Port ........... $port
  Username ....... $username
  Password ....... $password
  Save File ...... $savefile
${NC}" | tee -a $savefile

sleep 2

##NMAP

echo -e "${RED}
 =============================
|            nmap             |
 =============================
${NC}" | tee -a $savefile

cmd="nmap $target -p $port -Pn -sV --script=smb-os-discovery,smb-vuln*"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

##CRACKMAPEXEC

echo -e "${RED}
 =============================
|        crackmapexec         |
 =============================
${NC}" | tee -a $savefile

if [[ $username = "" && $password = "" ]]
then

    cmd="crackmapexec smb --port $port $target --rid-brute -u '' -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="crackmapexec smb --port $port $target --rid-brute -u Guest -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="crackmapexec smb --port $port $target --rid-brute -u Anonymous -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

fi

if [[ ! $username = "" ]] || [[ ! $password = "" ]]
then
    cmd="crackmapexec smb --port $port $target --rid-brute -u $username -p '$password' --shares --spider '*'"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
#echo "$cmd"
eval "$cmd"
fi

##ENUM4LINUX.PY

echo -e "${RED}
 =============================
|       enum4linux-ng.py      |
 =============================
${NC}" | tee -a $savefile

if [[ $username = "" && $password = "" ]]
then

    cmd="enum4linux-ng.py -vAR $target"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="enum4linux-ng.py -vAR $target -u '' -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="enum4linux-ng.py -vAR $target -u Guest -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="enum4linux-ng.py -vAR $target -u Anonymous -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

fi


if [[ ! $username = "" ]] || [[ ! $password = "" ]]
then
    cmd="enum4linux-ng.py -vAR $target -u $username -p '$password'"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
#echo $cmd
eval "$cmd"
fi

##SMBMAP

echo -e "${RED}
 =============================
|           smbmap            |
 =============================
${NC}" | tee -a $savefile

if [[ $username = "" && $password = "" ]]
then

    cmd="smbmap -H $target -u 'Anonymous' -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="smbmap -H $target -u 'Guest' -p ''"
    print_cmd "$cmd"
    eval "$cmd"

    cmd="smbmap -H $target -u '' -p ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

fi

if [[ ! $username = "" ]] || [[ ! $password = "" ]]
then
    cmd="smbmap -H $target -u $username -p '$password'"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"
fi

echo -e "${RED}
 =============================
|          smbclient          |
 =============================
${NC}" | tee -a $savefile

if [[ $username = "" && $password = "" ]]
then

    cmd="smbclient -L $target --port=$port --option='client min protocol=NT1' -N"
    print_cmd "$cmd"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=NT1' -U ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=NT1' -U 'Anonymous'"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=NT1' -U 'Guest'"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="smbclient -L $target --port=$port --option='client min protocol=LANMAN1' -N"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=LANMAN1' -U ''"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=LANMAN1' -U 'Anonymous'"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

    cmd="echo '' | smbclient -L $target --port=$port --option='client min protocol=LANMAN1' -U 'Guest'"
    print_cmd "$cmd"
    cmd="$cmd | tee -a $savefile"
    eval "$cmd"

fi

if [[ ! $username = "" || ! $password = "" ]]
then
    cmd="echo '$password' | smbclient -L $target --port=$port --option='client min protocol=LANMAN1' -U $username"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"
fi
