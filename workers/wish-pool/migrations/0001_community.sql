CREATE TABLE IF NOT EXISTS community_identities (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  seal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_identities_status
  ON community_identities(status, updated_at DESC);

INSERT OR IGNORE INTO community_identities(id, display_name, token_hash, seal, status, created_at, updated_at)
VALUES ('admin', '管理員', '', '#5fae98', 'active', 0, 0);

CREATE TABLE IF NOT EXISTS shared_neurons (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('card', 'board', 'fragment', 'task')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  intention TEXT NOT NULL DEFAULT 'share' CHECK (intention IN ('share', 'perspective', 'help')),
  origin_neuron_id TEXT,
  sample_key INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  comment_count INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (author_id) REFERENCES community_identities(id)
);

CREATE INDEX IF NOT EXISTS idx_shared_neurons_discovery
  ON shared_neurons(status, sample_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_neurons_author
  ON shared_neurons(author_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_neurons_origin
  ON shared_neurons(origin_neuron_id);

CREATE TABLE IF NOT EXISTS neuron_comments (
  id TEXT PRIMARY KEY,
  neuron_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (neuron_id) REFERENCES shared_neurons(id),
  FOREIGN KEY (author_id) REFERENCES community_identities(id)
);

CREATE INDEX IF NOT EXISTS idx_neuron_comments_neuron
  ON neuron_comments(neuron_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_neuron_comments_author
  ON neuron_comments(author_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS community_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('neuron', 'comment')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('harmful', 'privacy', 'spam', 'other')),
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (reporter_id) REFERENCES community_identities(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_unique_pending
  ON community_reports(reporter_id, target_type, target_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_community_reports_queue
  ON community_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS community_rate_limits (
  action TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(action, subject_hash, bucket)
);

CREATE INDEX IF NOT EXISTS idx_community_rate_limits_expiry
  ON community_rate_limits(expires_at);
