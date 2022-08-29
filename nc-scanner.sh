#!/bin/bash
declare -f showHelp
declare -f parse
declare -a ports
declare -a isDigit
declare -a checkArgs
declare -a scan
declare -a main

showHelp()
{
cat <<EOF
usage: $0 [-s server] [-h] <-p port>
	-s server
	-p port,80 or 1000-2000(from 1000 to 2000) or 22,80(scan 22 and 80)
	-h display this help and exit
EOF
exit 1
}

# parse commandline arguments
parse()
{
	verbose=false
	while getopts ":s:p:h" arg
	do
		case $arg in
			s)
				server=$OPTARG
				;;
			p)
				port=$OPTARG
				;;
			h)
				showHelp
				;;
			:|?|*)
				showHelp
				;;
		esac
	done

}

isDigit()
{
	if [[ $# -lt 1 ]]
	then
		return 1
	fi
	target=$1
	if [[ $1 =~ ^[0-9]+$ ]]
	then
		return 0
	else
		return 1
	fi
}

checkArgs()
{
	if [[ -z "$server" ]]
	then
		server=localhost
	fi

	while [[ -z "$port" ]]
	do
		read -p "Please type port: " port
	done	

	split=(${port//-/ }) # split by char '-', return an array.
	if [[ ${#split[@]} -ge 2 ]]
	then
		from=${split[0]}
		to=${split[1]}
		ports=()
		return 0
	fi
	ports=(${port//,/ }) # split by char ',', return an array.
}

scan()
{
	if [[ $# -ge 3 ]]
	then
		s=$1
		f=$2
		t=$3
		wt=$(seq 10 60 | sort -R | head -n1)
		if nc -w $wt -zv $s $f-$t 2>&1 | egrep -q -i "connected|succeeded";then
			echo "[+] Success! $s:$p"
		else
			echo "[-] Fail $s:$p"
		fi
	elif [[ $# -ge 2 ]]
	then
		s=$1
		p=$2
		wt=$(seq 10 60 | sort -R | head -n1)
		if nc -zvw $wt $s $p 2>&1 | egrep -q -i "connected|succeeded";then
			echo "[+] Success! $s:$p"
		else
			echo "[-] Fail $s:$p"
		fi
	fi
}

main()
{
	parse $@
	checkArgs $@

	if [[ ${#ports[@]} -gt 0 ]]
	then
		for i in ${ports[@]}
		do
			scan $server $i # I want to use sub-shell, but lead to spend more time
		done
	else
		scan $server $from $to
	fi
}

main $@
