#!/bin/python3
import argparse
import sys,os,socket
import smtplib,poplib
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
credQueue = queue.Queue()
workerList = []
killThreads = False

def show(key):
    if key == Key.enter:
        # Stop listener
        print(BLUE)
        print_info(f"Password Queue Size: {credQueue.qsize()}")
        print_info(f"Username Queue Size: {credQueue.qsize()}")
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

def print_success(msg):
    text = GREEN + "[+] " + msg + RSTCOLORS
    sys.stdout.write(ERASE_LINE)
    print("",end="\r",flush=True)
    print(text)

def print_info(msg):
    text = WHITE + "[*] " + msg + RSTCOLORS
    print(text)

def bannerGrab(target,port):
    sock = socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.connect((target,port))
    sock.send(''.encode())
    r = sock.recv(1024)
    banner = r.decode().strip()
    print_info(f"{BLUE}Banner: {banner}")


def loadQueue(filename):
    global credQueue
    
    with open(filename,'r') as f:
        for line in f:
            if args.domain is not None:
                line = line.strip() + "@" + args.domain
            credQueue.put(line)


def smtpVRFY(threadNum):
    global credQueue
    error_flag = False
    try:
        conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
    except:
        sleep(5)
        conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
    if args.debug:
        conn.set_debuglevel(2)

    if args.debug:
        print()
        print_info(f"Spawning Thread #{threadNum}")
    while not killThreads:
        if killThreads == True:
            if args.verbose:
                print_info(f"Killing Thread #{threadNum}")
            break
        if credQueue.empty() or credQueue.qsize() == 0:
            if args.debug:
                print()
                print_info("Queue is empty")
            #q.task_done()
            credQueue.join()
            #uQueue.join()
            break
        try:
            if error_flag is False:
                username = credQueue.get()
            else:
                if args.verbose:
                    print_info(f"Retrying --> {args.target}:{username}".strip())
                error_flag = False
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
                print_success(f"\nFound Username --> {args.target}:{username}".strip())
                SUCCESS.append(username.strip())
            else:
                pass
            credQueue.task_done()
        except smtplib.SMTPServerDisconnected:
            error_flag = True
            try:
                conn.close()
            except:
                pass
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
        except smtplib.SMTPConnectError:
            error_flag = True
            print_bad("Too many connections, turn down your jobs value")

        except socket.timeout:
            error_flag = True
            try:
                conn.close()
            except:
                pass
            conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")

        except ValueError:
            credQueue.task_done()
            if args.verbose:
                print_try(f"Illegal Value, Skipping: {username}")

def smtpControl():
    userObj = None
    global workerList

    if args.username is not None:
        userObj = args.username
    elif args.username_list is not None:
        userObj = args.username_list


    if os.path.isfile(userObj):
        loadQueue(userObj)
        for i in range(args.jobs):
            try:
                worker = threading.Thread(target=smtpVRFY, args=(i,), daemon=True)
                worker.daemon = True
            except:
                if not worker.is_alive():
                    workerList = [t for t in workerList if not t.handled]
            worker.start()
            workerList.append(worker)
            #sys.exit(0)

    else:
        conn = smtplib.SMTP(f"{args.target}:{str(args.port)}")
        result = conn.helo()
        if args.verbose:
            print_info(f"Trying --> {args.target}:{args.username}")
        result = conn.verify(args.username)
        if args.debug:
            print_info(str(result))
        if "2.1.5 " in str(result) or "2.0.0 " in str(result):
            print_good(f"\nFound Username --> {args.target}:{args.username}".strip())
            SUCCESS.append(args.username.strip())
        else:
            print_bad(f"Username Does Not Exist --> {args.target}:{args.username}")

def popAuth(threadNum):
    error_flag = False
    conn = None

    if args.ssl:
        conn = poplib.POP3_SSL(host=args.target,port=args.port,timeout=args.timeout)
    elif args.tls:
        conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
        conn.stls()
    else:
        conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
    
    if args.debug:
        conn.set_debuglevel(1)

    if args.debug:
        print()
        print_info(f"Spawning Thread #{threadNum}")
    result = conn.getwelcome()

    if args.debug:
        print_info(str(result))
    while not killThreads:
        if killThreads == True:
            if args.verbose:
                print_info(f"Killing Thread #{threadNum}")
            break
        if credQueue.empty() or credQueue.qsize() == 0:
            if args.debug:
                print()
                print_info("Queue is empty")
            #q.task_done()
            credQueue.join()
            #uQueue.join()
            break
        try:
            if error_flag is False:
                creds = credQueue.get()
            else:
                if args.verbose:
                    print_try(f"Retrying --> ({args.target}) - {username}::{password}")
                error_flag = False

            username = creds.split(r"{{}}")[0].strip()
            password = creds.split(r"{{}}")[1].strip()

            if args.verbose:
                print_try(f"Trying --> ({args.target}) - {username}::{password}")
            result = conn.user(username)
            if args.debug:
                print_info(str(result))
            
            result = conn.pass_(password)
            if args.debug:
                print_info(str(result))
            if "Logged" in str(result):
                print_good(f"\nFound Username --> ({args.target}) - {username}::{password}")
                creds = f"{username.strip()}::{password.strip()}"
                SUCCESS.append(creds)
            credQueue.task_done()
            #conn.noop()
        except Exception as e:
            
            if "Authentication failed" in str(sys.exc_info()):
                #print_bad(f"Credentials Failed --> ({args.target}) - {username}::{password}")
                pass
            else:
                try:
                    conn.quit()
                except:
                    pass
                error_flag = True
                #print(sys.exc_info())
                if args.ssl:
                    conn = poplib.POP3_SSL(host=args.target,port=args.port,timeout=args.timeout)
                elif args.tls:
                    conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
                    conn.stls()
                else:
                    conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
                if args.debug:
                    conn.set_debuglevel(1)
                result = conn.getwelcome()


def popControl():
    global workerList
    userObj = None
    if args.username is not None:
        userObj = args.username
    elif args.username_list is not None:
        userObj = args.username_list

    if args.password is not None:
        passObj = args.password
    elif args.password_list is not None:
        passObj = args.password_list

    threads = False
    if os.path.isfile(userObj) and os.path.isfile(passObj):

        u = open(userObj,"r")
        p = open(passObj,"r")
        from itertools import product
        for a, b in product(u, p):
            if args.domain is not None:
                a = a.strip() + "@" + args.domain
            credPair = a.strip() + r"{{}}" + b.strip()
            credQueue.put(credPair)
            #print(credPair)
        u.close()
        p.close()
        threads = True
    elif os.path.isfile(userObj) and not os.path.isfile(passObj):
        with open(userObj,"r") as u:
            for name in u:
                credPair = name.strip() + r"{{}}" + passObj.strip()
                credQueue.put(credPair)
                #print(credPair)
        threads = True
    elif not os.path.isfile(userObj) and os.path.isfile(passObj):
        with open(passObj,"r") as u:
            for pas in u:
                credPair =  userObj.strip() + r"{{}}" + pas.strip()
                credQueue.put(credPair)
                #print(credPair)
        threads = True
    

    if threads:
        for i in range(args.jobs):
            try:
                worker = threading.Thread(target=popAuth, args=(i,), daemon=True)
                worker.daemon = True
            except:
                if not worker.is_alive():
                    workerList = [t for t in workerList if not t.handled]
            worker.start()
            workerList.append(worker)
    else:
        if args.ssl:
            conn = poplib.POP3_SSL(host=args.target,port=args.port,timeout=args.timeout)
        elif args.tls:
            conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
            conn.stls()
        else:
            conn = poplib.POP3(host=args.target,port=args.port,timeout=args.timeout)
        
        try:
            #print("single auth mode")
            if args.domain is not None:
                username = args.username + "@" + args.domain
            else:
                username = args.username

            if args.debug:
                conn.set_debuglevel(2)
            
            result = conn.getwelcome()

            if args.debug:
                print_info(str(result))

            if args.verbose:
                print_info(f"Trying --> ({args.target}) - {username}::{args.password}")
            
            result = conn.user(username)
            if args.debug:
                print_info(str(result))
            result = conn.pass_(args.password)
            if args.debug:
                print_info(str(result))

            if "Logged" in str(result):
                print_good(f"Found Username --> ({args.target}) - {username}::{args.password}")
                creds = f"{username.strip()}::{args.password.strip()}"
                SUCCESS.append(creds)

        except Exception as e:
            if "Authentication failed" in str(sys.exc_info()):
                print_bad(f"Credentials Failed --> ({args.target}) - {username}::{args.password}")
            else:
                print(sys.exc_info())



def printSuccess():
    print()
    print(YELLOW+f"  Successes: {len(SUCCESS)}")
    for s in SUCCESS:
        print(BLUE + s)
    print(RSTCOLORS)

def probePort(target,port):
    s = newSocket()
     
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

def newSocket():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    socket.setdefaulttimeout(args.timeout)
    return s

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
    parser.add_argument('-s', help='socket timeout',dest='timeout', action='store',type=int,default=10)
    parser.add_argument('--domain', dest='domain', action='store', default=None)

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
            #print("POP3 not implemented yet!")
            #sys.exit()
            try:
                popControl()
            except poplib.error_proto:
                print_bad("POP3 Protocol Error")

        
    else:
        print_bad(f"Port {args.port} is closed")

    #pQueue.join()
    credQueue.join()
try:
    with Listener(on_press = show) as listener:   

        main()
        printSuccess()
        print_good("Finished!")
        #sys.exit()
except KeyboardInterrupt:
    print("\n^punt!")
    killThreads = True

    for w in workerList:
        w.join(2.0)
        #print(w.is_alive())

    if args.verbose:
        print_info("Dumping Queues...")
    #pQueue.join()
    credQueue.task_done()
    #uQueue.join()
    printSuccess()
    sys.exit()
