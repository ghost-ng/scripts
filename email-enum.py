import argparse
import sys,os,socket
import smtplib
import queue,threading
from time import sleep
from pynput.keyboard import Key, Listener

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
pQueue = None
pQueue = queue.Queue()
uQueue = queue.Queue()
workerList = []
killThreads = False

def show(key):
    if key == Key.enter:
        # Stop listener
        print(BLUE)
        print_info(f"Password Queue Size: {pQueue.qsize()}")
        print_info(f"Username Queue Size: {uQueue.qsize()}")
        print_info(f"Worker Amount: {len(workerList)}")
        print(RSTCOLORS)
        printSuccess()

def print_good(msg):
    text = GREEN + "[+] " + msg + RSTCOLORS
    print(text)

def print_bad(msg):
    text = RED + "[-] " + msg + RSTCOLORS
    print(text)

def print_try(msg):
    text = WHITE + "[*] " + msg + RSTCOLORS
    sys.stdout.write(ERASE_LINE)
    print(text,end="\r",flush=True)

def print_info(msg):
    text = WHITE + "[*] " + msg + RSTCOLORS
    print(text)

def bannerGrab(target,port):
    sock = socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.connect((target,port))
    sock.send(''.encode())
    r = sock.recv(1024)
    banner = r.decode().strip()
    print_info(f"Banner: {banner}")


def loadQueue(filename, q):
    global pQueue
    
    with open(filename,'r') as f:
        for line in f:
            q.put(line)


def smtpVRFY(q,threadNum):
    try:
        conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
    except:
        sleep(5)
        conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
    if args.debug:
        conn.set_debuglevel(2)

    if args.verbose:
        print()
        print_info(f"Spawning Thread #{threadNum}")
    while True:
        if killThreads == True:
            if args.verbose:
                print_info(f"Killing Thread #{threadNum}")
            break
        if q.empty():
            break
        try:
            username = q.get()
            if args.verbose:
                    print_try(f"Trying --> {args.target}:{username}".strip())
            try:
                result = conn.helo()
            except smtplib.SMTPServerDisconnected:
                conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
                result = conn.helo()
            if args.debug:
                print_info(str(result))
            result = conn.verify(username)
            if args.debug:
                print_info(str(result))
            if "2.1.5 " in str(result) or "2.0.0 " in str(result):
                print_good(f"Found Username --> {args.target}:{username}".strip())
                SUCCESS.append(username)
            else:
                pass
            q.task_done()
        except smtplib.SMTPServerDisconnected:
            try:
                conn.close()
            except:
                pass
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
        except smtplib.SMTPConnectError:
            print_bad("Too many connections, turn down your jobs value")

        except socket.timeout:
            try:
                conn.close()
            except:
                pass
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")


def smtpControl():
    userObj = None
    global workerList

    if args.username is not None:
        userObj = args.username
    elif args.username_list is not None:
        userObj = args.username_list


    if os.path.isfile(userObj):
        loadQueue(userObj,uQueue)
        for i in range(args.jobs):
            try:
                worker = threading.Thread(target=smtpVRFY, args=(uQueue, i,), daemon=False)
            except:
                if not worker.is_alive():
                    workerList = [t for t in workerList if not t.handled]
            worker.start()
            workerList.append(worker)

    else:
        s = smtpVRFY(userObj)
        if args.verbose:
            print_info(f"Trying --> {args.target}:{userObj}")
        if s:
            print_good(f"Found Username --> {args.target}:{userObj}")
        else:
            print_bad(f"Username Does Not Exist --> {args.target}:{userObj}")

def popAuth(username,password):
    global conn
    while True:
        try:
            result = conn.getwelcome()
            if args.debug:
                print_info(str(result))


            result = conn.user(username)
            if args.debug:
                print_info(str(result))
            result = conn.pass_(password)
            if args.debug:
                print_info(str(result))

            if "Authentication failed" in str(result):
                return False
            else:
                return False
        except smtplib.SMTPServerDisconnected:
            conn.close()
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
        except socket.timeout:
            conn.close()
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")


def popControl(conn):
    userObj = None
    if args.username is not None:
        userObj = args.username
    elif args.username_list is not None:
        userObj = args.username_list

    if args.password is not None:
        passObj = args.password
    elif args.password_list is not None:
        passObj = args.password_list


    if os.path.isfile(userObj) and os.path.isfile(pathObj):
        with open(userObj) as usernamefile:
            for username in usernamefile:
                with open(passObj) as passfile:
                    for password in passfile:
                        s = popAuth(username,password)
                        if args.verbose:
                            print_try(f"Trying --> {args.target}:{username}::{password}".strip())
                        if s:
                            print_good(f"Found Username --> {args.target}::{password}".strip())
                            SUCCESS.append(f"{username}::{password}")
                        else:
                            pass





def printSuccess():
    print()
    print(BLUE+f"Successes: {len(SUCCESS)}")
    for s in SUCCESS:
        print("  " + s,end="")
    print(RSTCOLORS)

def probePort(target,port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    socket.setdefaulttimeout(1)
     
    # returns an error indicator
    result = s.connect_ex((target,port))
    if result == 0:
        if args.verbose:
            print_good(f"Port {port} is open")
        s.close()
        return True
    else:
        s.close()
        return False

def isFile(file):
    if os.path.isfile(file):
        return file
    else:
        print_bad("File does not exist")
        sys.exit()

def main():
    global args
    global conn
    conn = None
    parser = argparse.ArgumentParser(description='Email Protocol Enumeration')
    
    subparsers = parser.add_subparsers(help='protocol enumeration choices',dest="protocol",required=True)
    smtp = subparsers.add_parser("smtp")
    pop = subparsers.add_parser("pop")
    imap = subparsers.add_parser("imap")

#GLOBAL
    parser.add_argument('-v', help='toggle verbose mode',dest='verbose', action='store_true', default=False)
    parser.add_argument('-j', help='jobs',dest='jobs', action='store',type=int, default=1)
    parser.add_argument('-d', help='toggle debug mode',dest='debug', action='store_true', default=False)
    parser.add_argument('-t', dest='target', action='store',required=True)
    parser.add_argument('-p', dest='port', action='store',required=True,type=int)
    parser.add_argument('-b', help='perform a banner grab',dest='banner', action='store_true',default=False)

    user = parser.add_mutually_exclusive_group(required=True)
    user.add_argument('-u', dest='username', action='store', default=None)
    user.add_argument('-U', type=isFile,dest='username_list', action='store', default=None)

    
#SMTP
    
    

#POP
    password = pop.add_mutually_exclusive_group(required=True)
    password.add_argument('-pass', dest='password', action='store', default=None)
    password.add_argument('-P', dest='password_list', action='store', default=None)
    secure = pop.add_mutually_exclusive_group(required=False)
    secure.add_argument('-tls', dest='tls', action='store_true', default=False)
    secure.add_argument('-ssl', dest='ssl', action='store_true', default=False)
    

    args = parser.parse_args()

    status = probePort(args.target,args.port)
    
    if status:
        if args.banner:
            bannerGrab(args.target,args.port)
        if args.protocol == "smtp":
            try:
                
                smtpControl()
            except smtplib.SMTPConnectError:
                print_bad("SMTP Protocol Error")

        if args.protocol == "pop":
            print("POP3 not implemented yet!")
            sys.exit()
            try:
                if args.ssl:
                    conn = poplib.POP3_SSL(f"{args.target}:{str(args.port)}")
                elif args.tls:
                    conn = poplib.POP3(f"{args.target}:{str(args.port)}")
                    conn.stls()
                else:
                    conn = poplib.POP3(f"{args.target}:{str(args.port)}")
                popControl(conn)
            except poplib.error_proto:
                print_bad("POP3 Protocol Error")

        
    else:
        print_bad(f"Port {args.port} is closed")

    pQueue.join()
    uQueue.join()
try:
    with Listener(on_press = show) as listener:   

        main()
        printSuccess()
except KeyboardInterrupt:
    print("\n^punt!")
    killThreads = True
    for w in workerList:
        w.join()
    if args.verbose:
        print_info("Dumping Queues...")
    sys.exit()
