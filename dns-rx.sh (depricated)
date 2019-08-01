#!/bin/bash
#$1 - listening interface
#$2 - save-as file
#$3 - host that will be transmitting file
#$4 - domain to extract
while true; do
	if tcpdump -i eth0 port 53 and host $3 -l -n -s 0 -w - | tee temp1.pcap | grep -m 1 --line-buffered EOF; then
	 echo "EOF reached"
	 tcpdump port 53 and host $3 -n -r temp1.pcap | grep $4 | cut -d ' ' -f 8 | cut -d '.' -f 1 | uniq | sed -e 's/\(EOF\)*$//g' > ./.temp2
	 break
	fi
done
base64 -d ./.temp2 > $2
rm ./.temp2
rm ./temp1.pcap
