package cursorinstall

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/Kuznetsov-Ilia/agy/internal/config"
)

func Run() error {
	root := config.AgyMcpRoot()
	if err := buildAgyMcp(root); err != nil {
		return err
	}
	if err := copyCursorPluginEmptyMcp(root); err != nil {
		return err
	}
	fmt.Println("cursor-install: plugin skills/rules copied; MCP not merged.")
	fmt.Println("PTY lease pool is retired. Superlab: bun run agy-pool:ensure")
	return nil
}

func buildAgyMcp(root string) error {
	nodeModules := filepath.Join(root, "node_modules")
	if _, err := os.Stat(nodeModules); os.IsNotExist(err) {
		if err := runCmd(root, "pnpm", "install"); err != nil {
			return err
		}
	}
	return runCmd(root, "pnpm", "build")
}

func runCmd(dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	return cmd.Run()
}

func copyCursorPluginEmptyMcp(root string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dst := filepath.Join(home, ".cursor", "plugins", "local", "agy-mcp")
	src := filepath.Join(root, "cursor-plugin")
	if err := os.RemoveAll(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := copyDir(src, dst); err != nil {
		return err
	}
	mcp := map[string]any{"mcpServers": map[string]any{}}
	data, err := json.MarshalIndent(mcp, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dst, "mcp.json"), append(data, '\n'), 0o644)
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}
