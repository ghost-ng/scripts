import argparse

class Decrypter:
	SIMPLE_STRING = "0123456789ABCDEF"
	SIMPLE_MAGIC = 0xA3

	def __init__(self, password):
		self.data = password

	def next(self):
		a = self.SIMPLE_STRING.index(self.data[0])
		b = self.SIMPLE_STRING.index(self.data[1])
		result = ~(((a << 4) + b) ^ self.SIMPLE_MAGIC) % 256
		self.discard(2)
		return result

	def discard(self, n=2):
		self.data = self.data[n:]

def decrypt(hostname, username, password):
	FLAG_SIMPLE = 0xFF

	decrypter = Decrypter(password)

	flag = decrypter.next()
	if flag == FLAG_SIMPLE:
		decrypter.discard(2)
		length = decrypter.next()
	else:
		length = flag

	offset = decrypter.next()
	decrypter.discard(offset*2)

	result = "".join([chr(decrypter.next()) for i in range(length)])

	key = username + hostname
	if flag == FLAG_SIMPLE and result.startswith(key):
		return result[len(key):]

	return result

def load_from_registry():
	import winreg
	results = []
	with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Martin Prikryl\WinSCP 2\Sessions") as key:
		count = winreg.QueryInfoKey(key)[0]
		for i in range(count):
			try:
				session = winreg.EnumKey(key, i)
				with winreg.OpenKey(key, session) as subkey:
					hostname = winreg.QueryValueEx(subkey, "HostName")[0]
					username = winreg.QueryValueEx(subkey, "UserName")[0]
					obfuscated = winreg.QueryValueEx(subkey, "Password")[0]

					password = decrypt(hostname, username, obfuscated)
					results.append((hostname, username, password))
			except FileNotFoundError:
				pass
	return results

def print_results(results, title=""):
	width = 50

	print("="*width)
	print(("WinSCP deobfuscation" + title).center(width))
	print("="*width)

	for hostname, username, password in results:
		print("                Host:", hostname)
		print("                User:", username)
		print("            Password:", password)
		print("-"*width)

if __name__=="__main__":
	#load_from_registry()

	parser = argparse.ArgumentParser(description='Deobfuscate WinSCP password, using info either from registry (if no arguments are given) or from the command line.')
	parser.add_argument('--hostname', type=str, help='HostName', required=False)
	parser.add_argument('--username', type=str, help='UserName', required=False)
	parser.add_argument('--hash', type=str, help='Password', required=False)

	args = parser.parse_args()

	if not (args.hostname or args.username or args.hash):
		results = load_from_registry()
		print_results(results, title=" from registry")
	elif args.hostname and args.username and args.hash:
		password = decrypt(args.hostname, args.username, args.hash)
		print_results([(args.hostname, args.username, password)], title=" from command line")
	else:
		parser.error("When using external values, please provide hostname, username and hash.")
