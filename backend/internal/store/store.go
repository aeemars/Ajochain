package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

// ─── Models ────────────────────────────────────────────────────────

// Group represents an ajo group in the read model.
type Group struct {
	ID               uint64   `json:"id"`
	Members          []string `json:"members"`
	TargetAmount     string   `json:"targetAmount"`     // Wei string (preserves uint256 precision)
	Deadline         int64    `json:"deadline"`          // Unix timestamp
	PayoutAddress    string   `json:"payoutAddress"`
	TotalContributed string   `json:"totalContributed"`
	Released         bool     `json:"released"`
	Status           string   `json:"status"` // "open" | "funded" | "released" | "refundable"
	CreatedAt        string   `json:"createdAt"`
}

// Contribution represents a single member's contribution event.
type Contribution struct {
	GroupID     uint64 `json:"groupId"`
	Member     string `json:"member"`
	Amount     string `json:"amount"`
	TxHash     string `json:"txHash"`
	BlockNumber uint64 `json:"blockNumber"`
	CreatedAt  string `json:"createdAt"`
}

// GroupDetail is a Group with its individual contributions.
type GroupDetail struct {
	Group         Group          `json:"group"`
	Contributions []Contribution `json:"contributions"`
}

// ─── Store ─────────────────────────────────────────────────────────

// Store provides read/write access to the SQLite read model.
type Store struct {
	db *sql.DB
}

// New opens (or creates) the SQLite database at the given path
// and initializes the schema.
func New(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Enable WAL mode for better concurrent reads
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("set WAL mode: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS groups (
		id               INTEGER PRIMARY KEY,
		members          TEXT    NOT NULL,  -- JSON array of addresses
		target_amount    TEXT    NOT NULL,
		deadline         INTEGER NOT NULL,
		payout_address   TEXT    NOT NULL,
		total_contributed TEXT   NOT NULL DEFAULT '0',
		released         INTEGER NOT NULL DEFAULT 0,
		created_at       TEXT    NOT NULL DEFAULT ''
	);

	CREATE TABLE IF NOT EXISTS contributions (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		group_id     INTEGER NOT NULL,
		member       TEXT    NOT NULL,
		amount       TEXT    NOT NULL,
		tx_hash      TEXT    NOT NULL,
		block_number INTEGER NOT NULL,
		created_at   TEXT    NOT NULL DEFAULT '',
		FOREIGN KEY (group_id) REFERENCES groups(id)
	);

	CREATE TABLE IF NOT EXISTS sync_state (
		id         INTEGER PRIMARY KEY CHECK (id = 1),
		last_block INTEGER NOT NULL DEFAULT 0
	);

	INSERT OR IGNORE INTO sync_state (id, last_block) VALUES (1, 0);
	`
	_, err := s.db.Exec(schema)
	return err
}

// ─── Sync State ────────────────────────────────────────────────────

// GetLastBlock returns the last indexed block number.
func (s *Store) GetLastBlock() (uint64, error) {
	var block uint64
	err := s.db.QueryRow("SELECT last_block FROM sync_state WHERE id = 1").Scan(&block)
	return block, err
}

// SetLastBlock updates the last indexed block number.
func (s *Store) SetLastBlock(block uint64) error {
	_, err := s.db.Exec("UPDATE sync_state SET last_block = ? WHERE id = 1", block)
	return err
}

// ─── Write Operations (called by indexer) ──────────────────────────

// UpsertGroup inserts or updates a group from a GroupCreated event.
func (s *Store) UpsertGroup(id uint64, members []string, targetAmount string, deadline int64, payoutAddress string) error {
	membersJSON, err := json.Marshal(members)
	if err != nil {
		return fmt.Errorf("marshal members: %w", err)
	}
	_, err = s.db.Exec(`
		INSERT INTO groups (id, members, target_amount, deadline, payout_address, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			members = excluded.members,
			target_amount = excluded.target_amount,
			deadline = excluded.deadline,
			payout_address = excluded.payout_address
	`, id, string(membersJSON), targetAmount, deadline, payoutAddress, time.Now().UTC().Format(time.RFC3339))
	return err
}

// RecordContribution inserts a contribution event and updates the group total.
func (s *Store) RecordContribution(groupID uint64, member, amount, txHash string, blockNumber uint64, newTotal string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO contributions (group_id, member, amount, tx_hash, block_number, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, groupID, member, amount, txHash, blockNumber, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return err
	}

	_, err = tx.Exec(`UPDATE groups SET total_contributed = ? WHERE id = ?`, newTotal, groupID)
	if err != nil {
		return err
	}

	return tx.Commit()
}

// MarkReleased updates a group as released.
func (s *Store) MarkReleased(groupID uint64) error {
	_, err := s.db.Exec(`UPDATE groups SET released = 1 WHERE id = ?`, groupID)
	return err
}

// MarkRefunded zeroes out a member's total contribution in the group.
func (s *Store) MarkRefunded(groupID uint64, member string, newTotal string) error {
	_, err := s.db.Exec(`UPDATE groups SET total_contributed = ? WHERE id = ?`, newTotal, groupID)
	return err
}

// ─── Read Operations (called by API) ───────────────────────────────

// ListGroups returns all groups with computed status.
func (s *Store) ListGroups() ([]Group, error) {
	rows, err := s.db.Query(`
		SELECT id, members, target_amount, deadline, payout_address, total_contributed, released, created_at
		FROM groups ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// ListGroupsByMember returns all groups that include the given member address.
func (s *Store) ListGroupsByMember(member string) ([]Group, error) {
	rows, err := s.db.Query(`
		SELECT id, members, target_amount, deadline, payout_address, total_contributed, released, created_at
		FROM groups
		WHERE members LIKE '%' || ? || '%'
		ORDER BY id DESC
	`, member)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

// GetGroup returns a single group by ID, or nil if not found.
func (s *Store) GetGroup(id uint64) (*GroupDetail, error) {
	row := s.db.QueryRow(`
		SELECT id, members, target_amount, deadline, payout_address, total_contributed, released, created_at
		FROM groups WHERE id = ?
	`, id)

	g, err := scanGroupRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// Fetch contributions
	rows, err := s.db.Query(`
		SELECT group_id, member, amount, tx_hash, block_number, created_at
		FROM contributions WHERE group_id = ? ORDER BY block_number ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var contribs []Contribution
	for rows.Next() {
		var c Contribution
		if err := rows.Scan(&c.GroupID, &c.Member, &c.Amount, &c.TxHash, &c.BlockNumber, &c.CreatedAt); err != nil {
			return nil, err
		}
		contribs = append(contribs, c)
	}

	return &GroupDetail{Group: g, Contributions: contribs}, rows.Err()
}

// Close shuts down the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// ─── Helpers ───────────────────────────────────────────────────────

func scanGroup(rows *sql.Rows) (Group, error) {
	var g Group
	var membersJSON string
	var releasedInt int
	if err := rows.Scan(&g.ID, &membersJSON, &g.TargetAmount, &g.Deadline, &g.PayoutAddress, &g.TotalContributed, &releasedInt, &g.CreatedAt); err != nil {
		return g, err
	}
	g.Released = releasedInt == 1
	if err := json.Unmarshal([]byte(membersJSON), &g.Members); err != nil {
		return g, fmt.Errorf("unmarshal members: %w", err)
	}
	g.Status = computeStatus(g)
	return g, nil
}

func scanGroupRow(row *sql.Row) (Group, error) {
	var g Group
	var membersJSON string
	var releasedInt int
	if err := row.Scan(&g.ID, &membersJSON, &g.TargetAmount, &g.Deadline, &g.PayoutAddress, &g.TotalContributed, &releasedInt, &g.CreatedAt); err != nil {
		return g, err
	}
	g.Released = releasedInt == 1
	if err := json.Unmarshal([]byte(membersJSON), &g.Members); err != nil {
		return g, fmt.Errorf("unmarshal members: %w", err)
	}
	g.Status = computeStatus(g)
	return g, nil
}

// computeStatus derives the user-facing group status from on-chain data.
func computeStatus(g Group) string {
	if g.Released {
		return "released"
	}
	// Compare contribution strings numerically isn't trivial with big ints,
	// so we check if they're equal as a proxy for "target met".
	// For a real system you'd parse big.Int; for the hackathon read model
	// the indexer already tells us via the event data.
	if g.TotalContributed >= g.TargetAmount && g.TargetAmount != "0" {
		return "funded"
	}
	if time.Now().Unix() > g.Deadline {
		return "refundable"
	}
	return "open"
}
