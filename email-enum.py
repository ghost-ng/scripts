import argparse
import sys,os,socket
import smtplib


#result = os.system('color')
BLUE = '\033[34m'
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
WHITE = '\033[0m'
RSTCOLORS = '\033[0m'
ERASE_LINE = '\x1b[2K' 
args = None
conn = None
SUCCESS = []


def print_good(msg):
	text = GREEN + "[+] " + msg + RSTCOLORS
	print(text)

def print_bad(msg):
	text = RED + "[+] " + msg + RSTCOLORS
	print(text)

def print_info(msg):
	text = WHITE + "[+] " + msg + RSTCOLORS
	sys.stdout.write(ERASE_LINE)
	print(text,end="\r",flush=True)

def smtpBanner(target,port):
	sock = socket.socket(socket.AF_INET,socket.SOCK_STREAM)
	sock.connect((target,port))
	sock.send('\r\n'.encode())
	r = sock.recv(1024)
	print_info(f"Banner: {r.decode()}".strip())

def smtpVRFY(username):
	global conn
	
	while True:
		try:
			result = conn.verify(username)
			if args.debug:
				print_info(str(result))
			if "2.1.5 " in result or "2.0.0 " in str(result):
				return True
			else:
				return False
		except smtplib.SMTPServerDisconnected:
			conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")


def smtpControl(conn):
	userObj = None
	if args.username is not None:
		userObj = args.username
	elif args.username_list is not None:
		userObj = args.username_list


	if args.banner:
		smtpBanner(args.target,args.port)

	if os.path.isfile(userObj):
		if args.verbose:
			print_info("Username File Found")
		with open(userObj, 'r') as fp:
			l = len(fp.readlines())

		with open(userObj) as file:
			for username in file:
				s = smtpVRFY(username)
				if args.verbose:
					print_info(f"Trying --> {args.target}:{username}".strip())
				if s:
					print_good(f"Found Username --> {args.target}:{username}".strip())
					SUCCESS.append(username)
				else:
					pass
		

	else:
		s = smtpVRFY(userObj)
		if args.verbose:
			print_info(f"Trying --> {args.target}:{userObj}")
		if s:
			print_good(f"Found Username --> {args.target}:{userObj}")
		else:
			print_bad(f"Username Does Not Exist --> {args.target}:{userObj}")

def printSuccess():
	print()
	print(BLUE+"Successes:")
	for s in SUCCESS:
		print("\t" + s,end="")
	print(RSTCOLORS)

def main():
	global args
	global conn
	conn = None
	parser = argparse.ArgumentParser(description='Email Protocol Enumeration')
	user = parser.add_mutually_exclusive_group(required=True)
	parser.add_argument('-t', dest='target', action='store',required=True)
	parser.add_argument(dest='protocol', action='store',choices=["smtp","pop","imap"])
	parser.add_argument('-p', dest='port', action='store',required=True,type=int)
	parser.add_argument('-b', dest='banner', action='store_true',default=False)
	user.add_argument('-u', dest='username', action='store', default=None)
	user.add_argument('-U', dest='username_list', action='store', default=None)
	parser.add_argument('-v', dest='verbose', action='store_true', default=False)
	parser.add_argument('-d', dest='debug', action='store_true', default=False)

	args = parser.parse_args()

	if args.protocol == "smtp":
		conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
		smtpControl(conn)

	printSuccess()

main()

