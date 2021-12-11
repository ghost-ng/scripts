#!/bin/python3
import sys
if len(sys.argv) == 1:
  print(f"Usage: {sys.argv[0]} [chunk size]\nSplit a string by X chunk size")
  sys.exit()
n = int(sys.argv[1])
text = input("String: ")
print('Str = ""')
for i in range(0, len(text), n):
  print("Str = Str + " + '"' + text[i:i+n] + '"')