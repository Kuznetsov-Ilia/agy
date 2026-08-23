package herdr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Client struct {
	Bin string
}

func NewClient() *Client {
	bin := os.Getenv("HERDR_BIN_PATH")
	if bin == "" {
		bin = "herdr"
	}
	return &Client{Bin: bin}
}

type Result struct {
	OK     bool
	Stdout string
	Stderr string
	Code   int
}

func (c *Client) Run(args ...string) Result {
	cmd := exec.Command(c.Bin, args...)
	cmd.Env = os.Environ()
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	code := 0
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			code = exit.ExitCode()
		} else {
			code = -1
		}
	}
	return Result{
		OK:     code == 0,
		Stdout: strings.TrimSpace(stdout.String()),
		Stderr: strings.TrimSpace(stderr.String()),
		Code:   code,
	}
}

func (c *Client) Available() bool {
	res := c.Run("status")
	return res.OK && strings.Contains(res.Stdout, "server:") && strings.Contains(res.Stdout, "status: running")
}

func (c *Client) JSON(args ...string) (map[string]any, error) {
	res := c.Run(args...)
	if !res.OK {
		msg := res.Stderr
		if msg == "" {
			msg = res.Stdout
		}
		return nil, fmt.Errorf("herdr %s failed: %s", strings.Join(args, " "), msg)
	}
	var doc map[string]any
	if err := json.Unmarshal([]byte(res.Stdout), &doc); err != nil {
		return nil, fmt.Errorf("herdr %s returned non-JSON", strings.Join(args, " "))
	}
	if result, ok := doc["result"].(map[string]any); ok {
		return result, nil
	}
	return doc, nil
}

func Str(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func Slice(m map[string]any, key string) []map[string]any {
	raw, ok := m[key].([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if mm, ok := item.(map[string]any); ok {
			out = append(out, mm)
		}
	}
	return out
}
