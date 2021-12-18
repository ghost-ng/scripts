#!/bin/bash
target=$1
port=$2
clr=$3

if [[ $clr == "nocolors" ]] 
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

function print_cmd {
	echo -e "${BLUE}[*] Command: $1${NC}" | tee -a $savefile
}



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
sleep 2

echo -e "${RED}
 ===================================
|         Target Information        |
 ===================================
  Target ......... $target
  Port ........... $port
${NC}" | tee -a $savefile


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

cmd="crackmapexec smb --port $port $target --rid-brute -u '' -p ''"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

cmd="crackmapexec smb --port $port $target --rid-brute -u Guest -p ''"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

cmd="crackmapexec smb --port $port $target --rid-brute  -u Anonymous -p ''"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

##ENUM4LINUX.PY

echo -e "${RED}
 =============================
|       enum4linux-ng.py      |
 =============================
${NC}" | tee -a $savefile

cmd="enum4linux-ng.py -AR 192.168.71.53"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

##SMBMAP

echo -e "${RED}
 =============================
|           smbmap            |
 =============================
${NC}" | tee -a $savefile

cmd="smbmap -H 192.168.71.53 -u 'Anonymous' -p ''"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

cmd="smbmap -H 192.168.71.53 -u 'Guest' -p ''"
print_cmd "$cmd"
eval "$cmd"

cmd="smbmap -H 192.168.71.53 -u '' -p ''"
print_cmd "$cmd"
cmd="$cmd | tee -a $savefile"
eval "$cmd"

echo -e "${RED}
 =============================
|          smbclient          |
 =============================
${NC}" | tee -a $savefile

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

