package cursorinstall

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/Kuznetsov-Ilia/agy/internal/config"
)

var sshEnv = map[string]string{
	"SSH_CONNECTION": "127.0.0.1 22 127.0.0.1 22",
	"SSH_CLIENT":     "127.0.0.1 22 22",
}

func Run() error {
	root := config.AgyMcpRoot()
	if err := buildAgyMcp(root); err != nil {
		return err
	}
	runServer := filepath.Join(root, "bin", "run-server.sh")
	if _, err := os.Stat(filepath.Join(root, "dist", "server.js")); err != nil {
		return fmt.Errorf("missing agy-mcp dist/server.js after build")
	}
	if err := copyCursorPlugin(root, runServer); err != nil {
		return err
	}
	return mergeUserMcp(runServer)
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

func agyEntry(runServer string, prev map[string]any) map[string]any {
	env := map[string]any{
		"SSH_CONNECTION":      sshEnv["SSH_CONNECTION"],
		"SSH_CLIENT":          sshEnv["SSH_CLIENT"],
		"AGY_PRINT_TIMEOUT":   "300s",
		"AGY_TIMEOUT_MS":      "360000",
		"AGY_TRANSPORT":       "herdr",
		"ON_FAILURE":          "strict",
	}
	if prev != nil {
		if prevEnv, ok := prev["env"].(map[string]any); ok {
			for _, key := range []string{"AGY_TRANSPORT", "ON_FAILURE", "AGY_POOL_SIZE", "AGY_POOL_LEASE_MS", "AGY_MCP_WORKSPACE_ROOT", "AGY_BIN", "AGY_MAX_BYTES"} {
				if v, ok := prevEnv[key]; ok {
					env[key] = v
				}
			}
		}
	}
	return map[string]any{
		"command": "bash",
		"args":    []any{runServer},
		"timeout": 600000,
		"env":     env,
	}
}

func copyCursorPlugin(root, runServer string) error {
	home, _ := os.UserHomeDir()
	dst := filepath.Join(home, ".cursor", "plugins", "local", "agy-mcp")
	src := filepath.Join(root, "cursor-plugin")
	if err := os.RemoveAll(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := copyDir(src, dst); err != nil {
		return err
	}
	mcp := map[string]any{"mcpServers": map[string]any{"agy": agyEntry(runServer, nil)}}
	data, _ := json.MarshalIndent(mcp, "", "  ")
	return os.WriteFile(filepath.Join(dst, "mcp.json"), append(data, '\n'), 0o644)
}

func mergeUserMcp(runServer string) error {
	home, _ := os.UserHomeDir()
	mcpPath := filepath.Join(home, ".cursor", "mcp.json")
	doc := map[string]any{"mcpServers": map[string]any{}}
	var prev map[string]any
	if data, err := os.ReadFile(mcpPath); err == nil {
		_ = json.Unmarshal(data, &doc)
	}
	if servers, ok := doc["mcpServers"].(map[string]any); ok {
		if p, ok := servers["agy"].(map[string]any); ok {
			prev = p
		}
	} else {
		doc["mcpServers"] = map[string]any{}
	}
	servers := doc["mcpServers"].(map[string]any)
	servers["agy"] = agyEntry(runServer, prev)

	if _, err := os.Stat(mcpPath); err == nil {
		bak := fmt.Sprintf("%s.bak.%d", mcpPath, time.Now().UnixMilli())
		_ = os.Rename(mcpPath, bak)
		fmt.Printf("→ backed up %s → %s\n", mcpPath, bak)
	}
	data, _ := json.MarshalIndent(doc, "", "  ")
	if err := os.WriteFile(mcpPath, append(data, '\n'), 0o644); err != nil {
		return err
	}
	fmt.Printf("→ merged agy into %s\n", mcpPath)
	return nil
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
