#!/usr/bin/env python3
import subprocess
import re
import argparse

def run_rpcclient(domain, k, username, password, dc, command):
    """Run rpcclient with the given arguments and return stdout."""
    base_cmd = ["rpcclient"]

    if k:
        base_cmd.append("-k")
    else:
        creds = f"{username}%{password}"
        base_cmd += ["-U", creds]

    base_cmd += ["-c", command, dc]

    result = subprocess.run(
        base_cmd,
        capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        print(f"[!] rpcclient error: {result.stderr.strip()}")
    return result.stdout

def get_domain_sid(domain, k, username, password, dc):
    output = run_rpcclient(domain, k, username, password, dc, f"lookupdomain {domain}")
    match = re.search(r"Domain SID:\s*(S-[0-9\-]+)", output)
    if match:
        return match.group(1)
    else:
        print("[!] Failed to get Domain SID.")
        exit(1)

def get_computer_rids(domain, k, username, password, dc):
    output = run_rpcclient(domain, k, username, password, dc, "querygroupmem 0x203")
    return re.findall(r"rid:\[0x([0-9a-fA-F]+)\]", output)

def resolve_computer_names(domain_sid, rids, domain, k, username, password, dc, verbose):
    full_sids = [f"{domain_sid}-{int(rid,16)}" for rid in rids]
    sids_str = ' '.join(full_sids)
    output = run_rpcclient(domain, k, username, password, dc, f"lookupsids {sids_str}")
    for line in output.splitlines():
        match = re.match(r"(S-[^\s]+)\s+([^\s]+) \((\d+)\)", line.strip())
        if match and '$' in match.group(2):
            sid, account, sidtype = match.groups()
            if verbose:
                print(f"{sid} {account} ({sidtype})")
            else:
                print(account.split("\\",1)[-1])  # print just the computer name

def main():
    parser = argparse.ArgumentParser(description="Enumerate computer accounts dynamically with rpcclient.")
    parser.add_argument("--domain", required=True, help="Target domain name (e.g., rustykey.htb)")
    parser.add_argument("-k", action="store_true", help="Use Kerberos authentication")
    parser.add_argument("-u", help="Username")
    parser.add_argument("-p", help="Password")
    parser.add_argument("--dc-ip", required=True, help="Domain controller IP or hostname")
    parser.add_argument("--verbose", action="store_true", help="Show full SID, domain name, and SID type")

    args = parser.parse_args()

    domain_sid = get_domain_sid(args.domain, args.k, args.u, args.p, args.dc_ip)
    rids = get_computer_rids(args.domain, args.k, args.u, args.p, args.dc_ip)
    if not rids:
        print("[!] No computer RIDs found.")
        return
    resolve_computer_names(domain_sid, rids, args.domain, args.k, args.u, args.p, args.dc_ip, args.verbose)

if __name__ == "__main__":
    main()

