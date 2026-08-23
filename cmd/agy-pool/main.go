package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/Kuznetsov-Ilia/agy/internal/config"
	"github.com/Kuznetsov-Ilia/agy/internal/cursorinstall"
	"github.com/Kuznetsov-Ilia/agy/internal/pool"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	cfg := config.Load()
	svc := pool.New(cfg, cfg.DefaultCWD)

	switch os.Args[1] {
	case "ensure":
		fs := flag.NewFlagSet("ensure", flag.ExitOnError)
		cwd := fs.String("cwd", cfg.DefaultCWD, "workspace cwd")
		size := fs.Int("size", cfg.PoolSize, "pool size")
		_ = fs.Parse(os.Args[2:])
		svc.CWD = *cwd
		svc.Size = *size
		result, err := svc.Ensure()
		if err != nil {
			fail(err)
		}
		printJSON(result)
	case "status":
		fs := flag.NewFlagSet("status", flag.ExitOnError)
		size := fs.Int("size", cfg.PoolSize, "pool size")
		_ = fs.Parse(os.Args[2:])
		svc.Size = *size
		result, err := svc.Status()
		if err != nil {
			fail(err)
		}
		printJSON(result)
	case "restart":
		if len(os.Args) < 3 {
			fail(fmt.Errorf("usage: agy-pool restart <N>"))
		}
		var n int
		if _, err := fmt.Sscanf(os.Args[2], "%d", &n); err != nil || n < 1 {
			fail(fmt.Errorf("invalid worker number"))
		}
		result, err := svc.Restart(n)
		if err != nil {
			fail(err)
		}
		printJSON(result)
	case "reconcile":
		if err := svc.Reconcile(); err != nil {
			fail(err)
		}
		result, _ := svc.Status()
		printJSON(result)
	case "watch":
		fs := flag.NewFlagSet("watch", flag.ExitOnError)
		interval := fs.Duration("interval", 30*time.Second, "reconcile interval")
		_ = fs.Parse(os.Args[2:])
		svc.Watch(*interval)
	case "cursor-install":
		if err := cursorinstall.Run(); err != nil {
			fail(err)
		}
		fmt.Println("cursor-install done")
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `Usage:
  agy-pool ensure [--cwd DIR] [--size N]
  agy-pool status [--size N]
  agy-pool restart <N>
  agy-pool reconcile
  agy-pool watch [--interval DURATION]
  agy-pool cursor-install
`)
}

func printJSON(v any) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fail(err)
	}
	fmt.Println(string(data))
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "agy-pool: %v\n", err)
	os.Exit(1)
}
