package pool

import (
	"os"
	"path/filepath"
	"syscall"
)

func lockPath(home string) string {
	return filepath.Join(leasesDir(home), "..", "ensure.lock")
}

func (s *Service) withLock(fn func() error) error {
	ensureDirs(s.Home)
	path := lockPath(s.Home)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}
