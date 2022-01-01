package main

import (
	"fmt"
	"io"
	"log"
	"net"
	"os"

	"github.com/akamensky/argparse"
)

var defaultListen = "0.0.0.0:9999"
var defaultConnect = "127.0.0.1:9999"

func main() {
	parser := argparse.NewParser("TCP Forwarding", "Simple TCP Forwarder")
	Listen := parser.String("l", "listen", &argparse.Options{Required: false, Help: "IP Address and Port", Default: defaultListen})
	Connect := parser.String("c", "connect", &argparse.Options{Required: false, Help: "IP Address and Port", Default: defaultConnect})

	errs := parser.Parse(os.Args)
	if errs != nil {
		// In case of error print error and print usage
		// This can also be done by passing -h or --help flags
		fmt.Print(parser.Usage(errs))
		os.Exit(0)
	}
	ln, err := net.Listen("tcp", *Listen)

	msg := "[*] L:" + *Listen + " --> C:" + *Connect
	fmt.Println(msg)
	if err != nil {
		panic(err)
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			panic(err)
		}

		go handleRequest(conn, *Connect)
	}
}

func handleRequest(conn net.Conn, connect string) {

	proxy, err := net.Dial("tcp", connect)
	if err != nil {
		log.Println("[-] Unable to connect")
	} else {
		log.Println(proxy.LocalAddr().String() + " <--> {Proxy} <--> " + proxy.RemoteAddr().String())
		go forward(conn, proxy)
		go forward(proxy, conn)
	}

}

func forward(src, dest net.Conn) {

	defer src.Close()
	defer dest.Close()
	io.Copy(src, dest)
}
