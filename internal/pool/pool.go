package pool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/Kuznetsov-Ilia/agy/internal/config"
	"github.com/Kuznetsov-Ilia/agy/internal/herdr"
)

const PoolLabel = "agy-pool"

type LeaseRecord struct {
	Worker     string `json:"worker"`
	LeaseID    string `json:"leaseId"`
	PID        int    `json:"pid"`
	LeasedAt   string `json:"leasedAt"`
	ResultPath string `json:"resultPath"`
}

type WorkerStatus struct {
	Name              string       `json:"name"`
	PaneID            string       `json:"pane_id,omitempty"`
	AgentStatus       string       `json:"agent_status,omitempty"`
	Lease             *LeaseRecord `json:"lease"`
	InteractiveReady  *bool        `json:"interactive_ready,omitempty"`
}

type EnsureResult struct {
	WorkspaceID      string         `json:"workspaceId"`
	Workers          []WorkerStatus `json:"workers"`
	CreatedWorkspace bool           `json:"createdWorkspace"`
}

type StatusResult struct {
	WorkspaceID *string        `json:"workspaceId"`
	Workers     []WorkerStatus `json:"workers"`
}

type Service struct {
	Herdr *herdr.Client
	Home  string
	Size  int
	CWD   string
}

func New(cfg config.Config, cwd string) *Service {
	if cwd == "" {
		cwd = cfg.DefaultCWD
	}
	home, _ := os.UserHomeDir()
	return &Service{
		Herdr: herdr.NewClient(),
		Home:  home,
		Size:  cfg.PoolSize,
		CWD:   cwd,
	}
}

func workerName(i int) string {
	return fmt.Sprintf("agy%d", i)
}

func leasesDir(home string) string {
	return filepath.Join(home, ".cache", "agy-pool", "leases")
}

func ensureDirs(home string) {
	_ = os.MkdirAll(leasesDir(home), 0o755)
	_ = os.MkdirAll("/tmp/agy-pool", 0o755)
}

func readLease(worker, home string) *LeaseRecord {
	data, err := os.ReadFile(filepath.Join(leasesDir(home), worker+".json"))
	if err != nil {
		return nil
	}
	var lease LeaseRecord
	if json.Unmarshal(data, &lease) != nil {
		return nil
	}
	return &lease
}

func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	return syscall.Kill(pid, 0) == nil
}

func reapStaleLeases(home string) {
	ensureDirs(home)
	entries, err := os.ReadDir(leasesDir(home))
	if err != nil {
		return
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		worker := strings.TrimSuffix(e.Name(), ".json")
		lease := readLease(worker, home)
		if lease != nil && !pidAlive(lease.PID) {
			_ = os.Remove(filepath.Join(leasesDir(home), e.Name()))
		}
	}
}

func (s *Service) findPoolWorkspace() (map[string]any, error) {
	result, err := s.Herdr.JSON("workspace", "list")
	if err != nil {
		return nil, err
	}
	for _, ws := range herdr.Slice(result, "workspaces") {
		if herdr.Str(ws, "label") == PoolLabel {
			return ws, nil
		}
	}
	return nil, nil
}

func (s *Service) listPanes(workspaceID string) ([]map[string]any, error) {
	result, err := s.Herdr.JSON("pane", "list", "--workspace", workspaceID)
	if err != nil {
		return nil, err
	}
	return herdr.Slice(result, "panes"), nil
}

func (s *Service) paneIsShell(paneID string) bool {
	result, err := s.Herdr.JSON("pane", "process-info", "--pane", paneID)
	if err != nil {
		return false
	}
	info, _ := result["process_info"].(map[string]any)
	procs, _ := info["foreground_processes"].([]any)
	if len(procs) == 0 {
		return false
	}
	p0, _ := procs[0].(map[string]any)
	name, _ := p0["name"].(string)
	return name == "zsh" || name == "bash" || name == "sh" || name == "-zsh"
}

func sleep(d time.Duration) {
	time.Sleep(d)
}

func (s *Service) waitForShell(paneID string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.paneIsShell(paneID) {
			return true
		}
		sleep(400 * time.Millisecond)
	}
	return s.paneIsShell(paneID)
}

func (s *Service) growPanes(workspaceID string, size int) ([]string, error) {
	panes, err := s.listPanes(workspaceID)
	if err != nil {
		return nil, err
	}
	for len(panes) < size {
		from := herdr.Str(panes[len(panes)-1], "pane_id")
		if from == "" {
			return nil, fmt.Errorf("agy-pool: no pane to split")
		}
		direction := "right"
		if len(panes)%2 == 0 {
			direction = "down"
		}
		split, err := s.Herdr.JSON("pane", "split", "--pane", from, "--direction", direction, "--no-focus")
		if err != nil {
			return nil, err
		}
		pane, _ := split["pane"].(map[string]any)
		if herdr.Str(pane, "pane_id") == "" {
			return nil, fmt.Errorf("agy-pool: pane split returned no pane_id")
		}
		panes, err = s.listPanes(workspaceID)
		if err != nil {
			return nil, err
		}
	}
	ids := make([]string, 0, size)
	for _, p := range panes {
		if id := herdr.Str(p, "pane_id"); id != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	if len(ids) > size {
		ids = ids[:size]
	}
	return ids, nil
}

func (s *Service) clearAgentName(target string) {
	s.Herdr.Run("agent", "rename", target, "--clear")
}

func (s *Service) freePane(paneID string, timeout time.Duration) bool {
	if s.paneIsShell(paneID) {
		return true
	}
	s.Herdr.Run("pane", "send-keys", paneID, "ctrl+c")
	sleep(200 * time.Millisecond)
	if s.paneIsShell(paneID) {
		return true
	}

	result, err := s.Herdr.JSON("pane", "process-info", "--pane", paneID)
	if err == nil {
		info, _ := result["process_info"].(map[string]any)
		shellPID, _ := info["shell_pid"].(float64)
		procs, _ := info["foreground_processes"].([]any)
		for _, raw := range procs {
			p, _ := raw.(map[string]any)
			pid, _ := p["pid"].(float64)
			if int(pid) > 0 && int(pid) != int(shellPID) {
				_ = syscall.Kill(int(pid), syscall.SIGTERM)
			}
		}
	}

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if s.paneIsShell(paneID) {
			return true
		}
		sleep(200 * time.Millisecond)
	}

	if result, err := s.Herdr.JSON("pane", "process-info", "--pane", paneID); err == nil {
		info, _ := result["process_info"].(map[string]any)
		shellPID, _ := info["shell_pid"].(float64)
		procs, _ := info["foreground_processes"].([]any)
		for _, raw := range procs {
			p, _ := raw.(map[string]any)
			pid, _ := p["pid"].(float64)
			if int(pid) > 0 && int(pid) != int(shellPID) {
				_ = syscall.Kill(int(pid), syscall.SIGKILL)
			}
		}
	}
	wait := timeout - 2*time.Second
	if wait < time.Second {
		wait = time.Second
	}
	return s.waitForShell(paneID, wait)
}

func isAgentNameTakenSamePane(err error, paneID string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "agent_name_taken") && strings.Contains(msg, "pane_id="+paneID)
}

func agentStatusHealthy(status string) bool {
	return status == "idle" || status == "working" || status == "blocked" || status == "done"
}

func (s *Service) workerNeedsRestart(name, expectedPane string, w WorkerStatus, agents []map[string]any) bool {
	if agentStatusHealthy(w.AgentStatus) {
		return false
	}

	var named map[string]any
	for _, a := range agents {
		if herdr.Str(a, "name") == name {
			named = a
			break
		}
	}

	// Transient startup: agy still owns the pane.
	if w.AgentStatus == "unknown" && !s.paneIsShell(expectedPane) {
		return false
	}
	if named != nil && herdr.Str(named, "pane_id") == expectedPane && herdr.Str(named, "agent") == "agy" {
		return false
	}

	if w.AgentStatus == "" {
		return true
	}
	if w.AgentStatus == "unknown" && s.paneIsShell(expectedPane) {
		return true
	}
	return false
}

func (s *Service) startWorker(name, paneID string) error {
	if !s.freePane(paneID, 15*time.Second) {
		return fmt.Errorf("agy-pool: pane %s not at shell for %s", paneID, name)
	}
	s.clearAgentName(name)
	s.clearAgentName(paneID)
	args := []string{"agent", "start", name, "--kind", "agy", "--pane", paneID, "--timeout", "60000", "--", "--dangerously-skip-permissions"}
	_, err := s.Herdr.JSON(args...)
	if isAgentNameTakenSamePane(err, paneID) {
		return nil
	}
	return err
}

func (s *Service) Ensure() (*EnsureResult, error) {
	var result *EnsureResult
	err := s.withLock(func() error {
		var innerErr error
		result, innerErr = s.ensure()
		return innerErr
	})
	return result, err
}

func (s *Service) ensure() (*EnsureResult, error) {
	ensureDirs(s.Home)
	reapStaleLeases(s.Home)
	if !s.Herdr.Available() {
		return nil, fmt.Errorf("agy-pool: herdr server not available")
	}

	created := false
	ws, err := s.findPoolWorkspace()
	if err != nil {
		return nil, err
	}
	if ws == nil {
		result, err := s.Herdr.JSON("workspace", "create", "--cwd", s.CWD, "--label", PoolLabel, "--no-focus")
		if err != nil {
			return nil, err
		}
		ws, _ = result["workspace"].(map[string]any)
		created = true
		if herdr.Str(ws, "workspace_id") == "" {
			return nil, fmt.Errorf("agy-pool: workspace create failed")
		}
	}

	workspaceID := herdr.Str(ws, "workspace_id")
	tabID := herdr.Str(ws, "active_tab_id")
	if tabID != "" {
		s.Herdr.Run("tab", "focus", tabID)
	}

	paneIDs, err := s.growPanes(workspaceID, s.Size)
	if err != nil {
		return nil, err
	}

	allAgents := []map[string]any{}
	if result, err := s.Herdr.JSON("agent", "list"); err == nil {
		allAgents = herdr.Slice(result, "agents")
	}

	for i := 1; i <= s.Size; i++ {
		name := workerName(i)
		paneID := paneIDs[i-1]

		var agentInPane, agentNamed map[string]any
		for _, a := range allAgents {
			if herdr.Str(a, "pane_id") == paneID {
				agentInPane = a
			}
			if herdr.Str(a, "name") == name {
				agentNamed = a
			}
		}

		if agentNamed != nil && herdr.Str(agentNamed, "pane_id") != paneID {
			s.clearAgentName(name)
		}

		if agentInPane != nil {
			status := herdr.Str(agentInPane, "agent_status")
			agentKind := herdr.Str(agentInPane, "agent")
			paneName := herdr.Str(agentInPane, "name")
			if paneName == name && (agentStatusHealthy(status) || (status == "unknown" && agentKind == "agy")) {
				continue
			}
			if agentKind == "agy" {
				if res := s.Herdr.Run("agent", "rename", paneID, name); res.OK {
					continue
				}
			}
			if paneName != "" && paneName != name {
				return nil, fmt.Errorf("agy-pool: pane %s occupied by %s; run restart %d", paneID, paneName, i)
			}
		}

		if err := s.startWorker(name, paneID); err != nil {
			return nil, err
		}
	}

	if callerTab := os.Getenv("HERDR_TAB_ID"); callerTab != "" && callerTab != tabID {
		s.Herdr.Run("tab", "focus", callerTab)
	}

	status, _ := s.Status()
	return &EnsureResult{
		WorkspaceID:      workspaceID,
		CreatedWorkspace: created,
		Workers:          status.Workers,
	}, nil
}

func (s *Service) Status() (*StatusResult, error) {
	ensureDirs(s.Home)
	reapStaleLeases(s.Home)

	var workspaceID *string
	ws, err := s.findPoolWorkspace()
	if err == nil && ws != nil {
		id := herdr.Str(ws, "workspace_id")
		workspaceID = &id
	}

	paneIDs := []string{}
	if workspaceID != nil {
		if panes, err := s.listPanes(*workspaceID); err == nil {
			for _, p := range panes {
				if id := herdr.Str(p, "pane_id"); id != "" {
					paneIDs = append(paneIDs, id)
				}
			}
			sort.Strings(paneIDs)
		}
	}

	liveAgents := []map[string]any{}
	if result, err := s.Herdr.JSON("agent", "list"); err == nil {
		liveAgents = herdr.Slice(result, "agents")
	}

	workers := make([]WorkerStatus, 0, s.Size)
	for i := 1; i <= s.Size; i++ {
		name := workerName(i)
		var expectedPane string
		if i-1 < len(paneIDs) {
			expectedPane = paneIDs[i-1]
		}
		var agent map[string]any
		for _, a := range liveAgents {
			if herdr.Str(a, "name") == name {
				agent = a
				break
			}
		}
		if agent == nil && expectedPane != "" {
			for _, a := range liveAgents {
				if herdr.Str(a, "pane_id") == expectedPane {
					agent = a
					break
				}
			}
		}
		w := WorkerStatus{Name: name, Lease: readLease(name, s.Home)}
		if expectedPane != "" {
			w.PaneID = expectedPane
		}
		if agent != nil {
			w.PaneID = herdr.Str(agent, "pane_id")
			w.AgentStatus = herdr.Str(agent, "agent_status")
			if v, ok := agent["interactive_ready"].(bool); ok {
				w.InteractiveReady = &v
			}
		}
		workers = append(workers, w)
	}

	return &StatusResult{WorkspaceID: workspaceID, Workers: workers}, nil
}

func (s *Service) Restart(n int) (*WorkerStatus, error) {
	var result *WorkerStatus
	err := s.withLock(func() error {
		var innerErr error
		result, innerErr = s.restart(n)
		return innerErr
	})
	return result, err
}

func (s *Service) restart(n int) (*WorkerStatus, error) {
	name := workerName(n)
	_ = os.Remove(filepath.Join(leasesDir(s.Home), name+".json"))

	ws, err := s.findPoolWorkspace()
	if err != nil {
		return nil, err
	}
	if ws == nil {
		if _, err := s.ensure(); err != nil {
			return nil, err
		}
		status, _ := s.Status()
		for _, w := range status.Workers {
			if w.Name == name {
				return &w, nil
			}
		}
		return nil, fmt.Errorf("worker %s not found", name)
	}

	size := s.Size
	if n > size {
		size = n
	}
	paneIDs, err := s.growPanes(herdr.Str(ws, "workspace_id"), size)
	if err != nil {
		return nil, err
	}
	if n-1 >= len(paneIDs) {
		return nil, fmt.Errorf("agy-pool: could not resolve pane for worker %s", name)
	}
	paneID := paneIDs[n-1]
	s.clearAgentName(name)
	s.clearAgentName(paneID)
	if !s.freePane(paneID, 20*time.Second) {
		return nil, fmt.Errorf("agy-pool: could not free pane %s for %s", paneID, name)
	}
	if err := s.startWorker(name, paneID); err != nil {
		return nil, err
	}
	status, _ := s.Status()
	for _, w := range status.Workers {
		if w.Name == name {
			return &w, nil
		}
	}
	return nil, fmt.Errorf("worker %s not found after restart", name)
}

func (s *Service) Reconcile() error {
	return s.withLock(func() error {
		return s.reconcile()
	})
}

func (s *Service) reconcile() error {
	status, err := s.Status()
	if err != nil {
		return err
	}
	if status.WorkspaceID == nil {
		_, err := s.ensure()
		return err
	}

	liveAgents := []map[string]any{}
	if result, err := s.Herdr.JSON("agent", "list"); err == nil {
		liveAgents = herdr.Slice(result, "agents")
	}

	for i, w := range status.Workers {
		expectedPane := w.PaneID
		if !s.workerNeedsRestart(w.Name, expectedPane, w, liveAgents) {
			continue
		}
		if _, err := s.restart(i + 1); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Watch(interval time.Duration) {
	for {
		if err := s.Reconcile(); err != nil {
			fmt.Fprintf(os.Stderr, "agy-pool watch: %v\n", err)
		}
		time.Sleep(interval)
	}
}
