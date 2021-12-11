#!/bin/python3
import sys
import subprocess
subprocess.check_call(["stty","-icanon"])
if len(sys.argv) == 1:
  print(f"Usage: {sys.argv[0]} [chunk size]\nSplit a string by X chunk size")
  sys.exit()
n = int(sys.argv[1])
text = input("String: ")
print("Text Length:",len(text))
print()
print("++++++++COPY BELOW++++++++")
print('Str = ""')
#chunks = []
chunks = [text[i:i+n] for i in range(0, len(text), n)]
for i in chunks:
  print(f"Str = Str + \"{i}\"")
#print(len(chunks))
subprocess.check_call(["stty","icanon"])
print("++++++++END++++++++")
