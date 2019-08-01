#!/bin/bash
#use the '-h' option to view the help (syntax) file
#Usage: hping3 [sender ip] --listen [signature] -I [interface] > [file]
while getopts h option
do
        case "${option}"
        in
                h) echo "
#-h - this help mess
#\$1 - sending IP
#\$2 - signature
#\$3 - interface
#\$4 - plain text file to save as
#Usage: hping3 [sender ip] --listen [signature] -I [interface] > [file]
"
exit;;
        esac
done
hping3 $1 --listen $2 -I $3 > ./.temp1
trap " " INT
echo "passed trap"
#cut -f1 -d '=' ./.temp1 | tr -d '\n' > ./.temp2
#echo -n '==' | cat ./.temp2 - > ./exfil.base64
#base64 -d ./exfil.base64 > $4
#rm ./.temp2 & rm ./.temp1
mv ./.temp1 ./$4
rm ./.temp1
