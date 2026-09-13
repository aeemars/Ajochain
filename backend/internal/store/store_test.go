package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func setupTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	s, err := New(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	cleanup := func() {
		s.Close()
		os.RemoveAll(dir)
	}
	return s, cleanup
}

func TestStore_SyncState(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	block, err := s.GetLastBlock()
	if err != nil {
		t.Fatalf("GetLastBlock failed: %v", err)
	}
	if block != 0 {
		t.Errorf("expected initial block 0, got %d", block)
	}

	if err := s.SetLastBlock(12345); err != nil {
		t.Fatalf("SetLastBlock failed: %v", err)
	}

	block, err = s.GetLastBlock()
	if err != nil {
		t.Fatalf("GetLastBlock after update failed: %v", err)
	}
	if block != 12345 {
		t.Errorf("expected block 12345, got %d", block)
	}
}

func TestStore_GroupLifecycle(t *testing.T) {
	s, cleanup := setupTestStore(t)
	defer cleanup()

	members := []string{
		"0x1111111111111111111111111111111111111111",
		"0x2222222222222222222222222222222222222222",
	}
	deadline := time.Now().Add(24 * time.Hour).Unix()
	payout := "0x9999999999999999999999999999999999999999"

	// 1. Create group
	err := s.UpsertGroup(0, members, "100000000", deadline, payout)
	if err != nil {
		t.Fatalf("UpsertGroup failed: %v", err)
	}

	// 2. Read group
	detail, err := s.GetGroup(0)
	if err != nil {
		t.Fatalf("GetGroup failed: %v", err)
	}
	if detail == nil {
		t.Fatal("expected group to be found")
	}
	if detail.Group.TargetAmount != "100000000" {
		t.Errorf("expected target 100000000, got %s", detail.Group.TargetAmount)
	}
	if detail.Group.Status != "open" {
		t.Errorf("expected status open, got %s", detail.Group.Status)
	}
	if len(detail.Group.Members) != 2 {
		t.Errorf("expected 2 members, got %d", len(detail.Group.Members))
	}

	// 3. Record contribution
	err = s.RecordContribution(0, members[0], "50000000", "0xtx1", 100, "50000000")
	if err != nil {
		t.Fatalf("RecordContribution failed: %v", err)
	}

	detail, err = s.GetGroup(0)
	if err != nil {
		t.Fatalf("GetGroup failed: %v", err)
	}
	if detail.Group.TotalContributed != "50000000" {
		t.Errorf("expected total 50000000, got %s", detail.Group.TotalContributed)
	}
	if len(detail.Contributions) != 1 {
		t.Errorf("expected 1 contribution, got %d", len(detail.Contributions))
	}

	// 4. Reach target (funded)
	err = s.RecordContribution(0, members[1], "50000000", "0xtx2", 101, "100000000")
	if err != nil {
		t.Fatalf("RecordContribution failed: %v", err)
	}

	detail, err = s.GetGroup(0)
	if err != nil {
		t.Fatalf("GetGroup failed: %v", err)
	}
	if detail.Group.Status != "funded" {
		t.Errorf("expected status funded, got %s", detail.Group.Status)
	}

	// 5. Mark released
	err = s.MarkReleased(0)
	if err != nil {
		t.Fatalf("MarkReleased failed: %v", err)
	}

	detail, err = s.GetGroup(0)
	if err != nil {
		t.Fatalf("GetGroup failed: %v", err)
	}
	if !detail.Group.Released {
		t.Errorf("expected released true, got false")
	}
	if detail.Group.Status != "released" {
		t.Errorf("expected status released, got %s", detail.Group.Status)
	}

	// 6. List by member
	groups, err := s.ListGroupsByMember(members[0])
	if err != nil {
		t.Fatalf("ListGroupsByMember failed: %v", err)
	}
	if len(groups) != 1 {
		t.Errorf("expected 1 group for member, got %d", len(groups))
	}
}
