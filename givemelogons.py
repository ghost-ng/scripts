#!/usr/bin/python3
import csv 
import sys
import re
import argparse
import os
# open a csv file with the open function

#ID 4768 - TGT was granted (successfull domain auth)

# options:
#	domain logins
#	local logins


def dump_rdp_successful_logins(infile, writer):
	count = 0
	logins = 0
	result = []
	if args.verbose:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address", "Message"]
	else:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address"]

	if not args.append:
		writer.writerow(header)


	with open(infile, newline='') as csvfile:
	# create an iterator object with the csv.reader() function
		dict_reader = csv.DictReader(csvfile)
		# iterate over the reader object
		for row in dict_reader:
			count += 1
			if row["Event ID"] == "1149":
				logins += 1
				username = re.search(r'User:(.*)', row[None][0]).group(1).strip()
				domain = re.search(r'Domain:(.*)', row[None][0]).group(1).strip()
				source = re.search(r'Source Network Address:(.*)', row[None][0]).group(1).strip()
				message = row[None][0]
				timestamp = row["Date and Time"]
				eventID = "1149"
				if args.verbose:
					writer.writerow([eventID, timestamp, username, domain, source, message])
				else:
					writer.writerow([eventID, timestamp, username, domain, source])

	print(f"Found {str(count)} records")
	print(f"Found {str(logins)} successfull rdp authentications")

def dump_kerb_auth_events(infile, writer):
	count = 0
	logins = 0
	result = []
	if args.verbose:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address", "Message"]
	else:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address"]

	
	if not args.append:
		writer.writerow(header)

	with open(infile, newline='') as csvfile:
		# create an iterator object with the csv.reader() function
		dict_reader = csv.DictReader(csvfile)
		# iterate over the reader object
		for row in dict_reader:
			count += 1
			if row["Event ID"] == "4768" and "$" not in row[None][0]:
				logins += 1				
				username = re.search(r'Account Name:(.*)', row[None][0]).group(1).strip()
				domain = re.search(r'Realm Name:(.*)', row[None][0]).group(1).strip()
				source = re.search(r'Client Address:(.*)', row[None][0]).group(1).strip()
				message = row[None][0]
				timestamp = row["Date and Time"]
				eventID = "4768"
				if args.verbose:
					writer.writerow([eventID, timestamp, username, domain, source, message])
				else:
					writer.writerow([eventID, timestamp, username, domain, source])
			
				
	print(f"Found {str(count)} records")
	print(f"Found {str(logins)} successfull kerberos authentication events")


def dump_login_auth_events(infile, writer):
	count = 0
	logins = 0
	result = []
	if args.verbose:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address", "Message"]
	else:
		header = ["Event ID", "Timestamp", "Username", "Domain", "Source Address"]

	
	if not args.append:
		writer.writerow(header)

	with open(infile, newline='') as csvfile:
		# create an iterator object with the csv.reader() function
		dict_reader = csv.DictReader(csvfile)
		# iterate over the reader object
		for row in dict_reader:
			count += 1
			if row["Event ID"] == "4624" and "$" not in row[None][0]:
				logins += 1				
				username = re.findall(r'Account Name:(.*)', row[None][0])[1].strip()
				domain = re.findall(r'Account Domain:(.*)', row[None][0])[1].strip()
				source = re.search(r'Source Network Address:(.*)', row[None][0]).group(1).strip()
				message = row[None][0]
				timestamp = row["Date and Time"]
				eventID = "4624"
				if args.verbose:
					writer.writerow([eventID, timestamp, username, domain, source, message])
				else:
					writer.writerow([eventID, timestamp, username, domain, source])

				
	print(f"Found {str(count)} records")
	print(f"Found {str(logins)} successfull user authentication events")

def main():
	global args

	USAGE = f"""

Take in a csv formatted event log and output a new csv with specific login events.
Currently works for domain authentication events and local successful rdp events.

rdp logs            -> keyword:rdp eventid: 1149
kerberos logs       -> keyword:kerb eventid:4768
generic logon logs  -> keyword:logons eventid:4624

{sys.argv[0]} domain -i security.csv -o logins.csv
{sys.argv[0]} domain -i security.csv -v
{sys.argv[0]} rdp -i rdp_logs.csv -o rpd_logins.csv

"""


	parser = argparse.ArgumentParser(description="",formatter_class=argparse.RawDescriptionHelpFormatter, epilog=USAGE)
	parser.add_argument('-v', action="store_true", required=False, dest='verbose',help="output event log message in csv file")
	parser.add_argument('-o', type=str, action="store", required=False, default="events.csv",dest='outfile',help="csv save file")
	parser.add_argument('-i', type=str, action="store", required=True, dest='infile',help="csv formatted event log")
	parser.add_argument('-a', action="store_true", required=False, dest='append',help="append to an already existing csv output file")
	parser.add_argument("eventtype", choices=['rdp', 'kerb', 'logons'], help="choose the event type to be used for paring events")
	args = parser.parse_args()

	if os.path.splitext(args.infile)[1] != ".csv":
		print("Not a recognized file type, must be .csv")
		sys.exit()
	else:
		infile = args.infile

	
	if args.append:
		file = open(args.outfile, 'a', encoding='utf-8')
	else:
		file = open(args.outfile, 'w', encoding='utf-8')

	writer = csv.writer(file)

	if args.eventtype == "kerb":
		dump_kerb_auth_events(infile, writer)
	elif args.eventtype == "logons":
		dump_login_auth_events(infile, writer)
	elif args.eventtype == "rdp":
		dump_rdp_successful_logins(infile,writer)

	file.close()
	print("Output File:", args.outfile)

main()






