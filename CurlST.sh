#accepted input - curl_server.sh DOMAIN or curl_server.sh FILE OUTPUT_FILE
#DO NOT ENTER OUTPUT_FILE ARGUMENT IF NOT INPUTTING A FILE
input="$1"
output="$2"
if [[ -f "${input}" ]]
then
	#echo "this is a file"
	while read -r domain || [[ -n "$domain" ]]; do
	#curl -sD - -o /dev/null -A "Mozilla/4.0" http://$domain/ | tr -d '\r'| sed -e '/Server/p' -e '/Location/!d' | paste - -
	server_type=$(curl -m 10 -sD - -o /dev/null -A "Mozilla/4.0" http://$domain/ | tr -d '\r'| sed -e '/Server/!d')
	echo -e "$domain $server_type" >> $output
	done < "$input"
else
#echo "This is not a file"
curl -sD - -o /dev/null -A "Mozilla/4.0" http://$input/ | tr -d '\r'| sed -e '/Server/p' -e '/Location/!d' | paste - - -d " "
fi
