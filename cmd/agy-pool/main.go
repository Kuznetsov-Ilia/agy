package main

import (
	"fmt"
	"os"

	"github.com/Kuznetsov-Ilia/agy/internal/cursorinstall"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "cursor-install":
		if err := cursorinstall.Run(); err != nil {
			fail(err)
		}
		fmt.Println("cursor-install done")
	case "ensure", "status", "restart", "reconcile", "watch":
		fmt.Fprintln(os.Stderr, "agy.delegate PTY pool is retired.")
		fmt.Fprintln(os.Stderr, "Use Superlab: bun run agy-pool:ensure | status | watch")
		os.Exit(2)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `Usage:
  agy-pool cursor-install   # skills/rules only; does not restore herdr MCP
  (ensure/status/… retired — Superlab bun run agy-pool:ensure)
`)
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "agy-pool: %v\n", err)
	os.Exit(1)
}
