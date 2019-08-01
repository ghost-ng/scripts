import string
import random
import os.path

def get_file_amt():
    global num_files
    print("**Try a small amount of files to learn the script's behavior first**")
    num_files = input("# of files to create=")
    num_files = int(num_files)
        
def get_wkdir():
    global wkdir
    print("What directory would you like the files to be created in?") 
    print("**Example:")
    print("**C:\\Users\\username\\Documents\\ for Windows or /root/home/username/ for linux based OS")
    print("**")
    print("**If you don't add a slash as the last character then the prgm will interpret the characters as the filename.")

    wkdir = input()
    if os.path.isdir(wkdir) is False:
        print("Invalid Path Name.  Check path and try again")
        get_wkdir()
    pass
    
def create_files(filename, size, extension):
    try:
        file = open(filename, "wb")
        file.write(b"\0" * size)
        file.close()
    except IOError:
        print("I/O Error. Check permissions or path and try again")
        print("Ensure the directory ends with '/' or '\'")
        main()

def gen_random_type(size, chars):
    return ''.join(random.choice(chars) for x in range(size))

def gen_random_size(min_file_size, max_file_size):
    return random.randint(min_file_size, max_file_size) 

def gen_random_filename(wkdir, count, extension):
    seq = (wkdir, str(count) , ".", extension)
    filename = ''.join(seq)
    return filename

def main():
    count = 1
    get_file_amt()
    get_wkdir()
    filename = ""
    
    while count <= num_files:
        extension = gen_random_type(3, string.ascii_lowercase)
        size = gen_random_size(min_file_size, max_file_size)
        filename = gen_random_filename(wkdir, count, extension)
        create_files(filename, size, extension)
        count = count + 1
     
    print(count-1, "Files created")
    exit()
    
#START
global min_file_size
global max_file_size

min_file_size = input("Lower limit(KB)=")
max_file_size = input("Upper limit(KB)=")
min_file_size = 1024 * int(min_file_size)
max_file_size = 1024 * int(max_file_size)

#min_file_size = 1024 #in bytes
#max_file_size = 5024 #in bytes
main()
