import sys
def ipRange(start_ip, end_ip):
    start = list(map(int, start_ip.split(".")))
    end = list(map(int, end_ip.split(".")))
    temp = start
    ip_range = []
	
    ip_range.append(start_ip)
    while temp != end:
        start[3] += 1
        for i in (3, 2, 1):
            if temp[i] == 256:
                temp[i] = 0
                temp[i-1] += 1
        ip_range.append(".".join(map(str, temp)))	 
    
    return ip_range
	 
input_file = sys.argv[1]
new_file = sys.argv[2]

with open(input_file,"r") as file:
    new_file = open(new_file,"w")
    for line in file:
        temp = line.split("-")
        ip_range = ipRange(temp[0], temp[1])
        for ip in ip_range:
            if not (ip.endswith(".0") or ip.endswith(".255")):
                new_file.write(ip + "\n")
new_file.close()