import sys
import argparse
import socket
import threading
import queue
import os

task_queue = queue.Queue(10)

class ScanController (threading.Thread):
        
    def __init__(self, thread_id, port):
        threading.Thread.__init__(self)
        self.thread_id = thread_id
        self.port = port

    def run(self):
        #print("running thread", self.thread_id)
        scan(self.port)

def scan(port):
    global exitFlag
    global task_queue

    exitFlag = False
    while not exitFlag:
        if not task_queue.empty():
            ip = task_queue.get()
            #print("Scanning {}:{}".format(ip, port))
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3)
            try:
                s.connect((ip, int(port)))
                s.close()
                print(ip)
            except:
                pass   

def load_queue(filename):
    global task_queue
    with open(filename, "r") as file:
        for ip in file:
            task_queue.put(ip.rstrip())
    #print("Queue Loaded")

def file_exists(filename):
    exists = os.path.isfile(filename)  # initial check   
    while exists is False:
        print_fail("File does not exist, try again")
        file = input("[New File]: ")
        return file_exists(file)
    return exists

def main():
    global exitFlag
    parser = argparse.ArgumentParser(description='')
    parser.add_argument('-f', dest='file', action='store')
    parser.add_argument('-p', dest='port', action='store')
    parser.add_argument('--threads', dest='threads', action='store', default=1)
    args = parser.parse_args()

    filename = args.file
    temp = file_exists(filename)
    threads = []
    num_threads = args.threads
    port = args.port

    try:
        load_queue(filename)
    except KeyboardInterrupt:
        #print("punch!")
        pass
    except Exception as e:
        #print(e)
        #print("Error on Line:{}".format(sys.exc_info()[-1].tb_lineno))
        pass

    try:
        # Wait for queue to empty
        for x in range(int(num_threads)):
            # Create new threads
            thread = ScanController(x, port)
            thread.start()
            threads.append(thread)
        while not task_queue.empty():
            pass
        # Notify threads it's time to exit
        exitFlag = True
        # Wait for all threads to complete
        for t in threads:
            t.join()
        #print ("All Done!")
    except Exception as e:
        #print(e)
        pass

if __name__ == '__main__':
    main()
