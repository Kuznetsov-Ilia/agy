package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
)

const DefaultPoolSize = 5

type Config struct {
	PoolSize   int    `json:"pool_size"`
	DefaultCWD string `json:"default_cwd"`
	AgyBin     string `json:"agy_bin"`
}

func Load() Config {
	cfg := Config{
		PoolSize:   poolSizeFromEnv(),
		DefaultCWD: os.Getenv("HOME"),
	}
	dir := pluginConfigDir()
	if dir == "" {
		return cfg
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	if cfg.PoolSize < 1 || cfg.PoolSize > 16 {
		cfg.PoolSize = DefaultPoolSize
	}
	if cfg.DefaultCWD == "" {
		cfg.DefaultCWD = os.Getenv("HOME")
	}
	return cfg
}

func pluginConfigDir() string {
	if d := os.Getenv("HERDR_PLUGIN_CONFIG_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "herdr", "plugins", "config", "agy.delegate")
}

func poolSizeFromEnv() int {
	if v := os.Getenv("AGY_POOL_SIZE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 16 {
			return n
		}
	}
	return DefaultPoolSize
}

func PluginRoot() string {
	if r := os.Getenv("HERDR_PLUGIN_ROOT"); r != "" {
		return r
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return cwd
}

func AgyMcpRoot() string {
	return filepath.Join(PluginRoot(), "agy-mcp")
}
