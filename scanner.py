# simple port scan tool
# !/usr/bin/python
# -*- coding: utf-8 -*-

import optparse,sys
from socket import *
from threading import *

screenLock = Semaphore(value=1)


def connScan(tgtHost, tgtPort):
    global debug
    try:
        connSkt = socket(AF_INET, SOCK_STREAM)
        connSkt.connect((tgtHost, tgtPort))
        connSkt.send('\r\n'.encode())
        results = connSkt.recv(1024).decode()
        screenLock.acquire()
        print('[+] %d/tcp open' % tgtPort)
        print('[+] ' + str(results))
    except:
        screenLock.acquire()
        if debug:
            print('[-] %d/tcp closed' % tgtPort)
    finally:
        screenLock.release()
        connSkt.close()


def portScan(tgtHost, tgtPorts):
    try:
        tgtIP = gethostbyname(tgtHost)
    except:
        print("[-] Cannot resolve '%s': Unknown host" % tgtHost)
        return

    try:
        tgtName = gethostbyaddr(tgtIP)
        print('[+] Scan Results for: ' + tgtName[0])
    except:
        print('[+] Scan Results for: ' + tgtIP)

    setdefaulttimeout(1)
    for tgtPort in tgtPorts:
        t = Thread(target=connScan, args=(tgtHost, int(tgtPort)))
        t.start()


def main():
    global debug
    parser = optparse.OptionParser('usage %prog ' + \
                                   '-H <target host> -p <target port>')
    parser.add_option('-H', dest='tgtHost', type='string',
                      help='specify target host')
    parser.add_option('-d', action='store_true',dest='debug',default=False,
                      help='enable debug mode')
    parser.add_option('-p', dest='tgtPort', type='string',
                      help='specify target port[s] separated by comma')

    (options, args) = parser.parse_args()
    tgtPorts = options.tgtPort
    tgtHost = options.tgtHost
    debug = options.debug

    if (tgtHost == None) | (tgtPorts[0] == None):
        print(parser.usage)
        exit(0)

    if "," in options.tgtPort:
        tgtPorts = str(options.tgtPort).split(',')
    elif "-" in options.tgtPort:
        tgtPorts = list(range(1,int(options.tgtPort.split('-')[1])))+[len(list(range(1,int(options.tgtPort.split('-')[1]))))+1]

    portScan(tgtHost, tgtPorts)


if __name__ == '__main__':
    main()
