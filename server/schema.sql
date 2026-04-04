PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_json TEXT,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  summary TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  extracted_text TEXT,
  image_description TEXT,
  key_terms_json TEXT NOT NULL DEFAULT '[]',
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processed_at TEXT,
  processing_error TEXT,
  analysis_model TEXT,
  analysis_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_chunks (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  attachment_id TEXT,
  source TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  start_offset INTEGER,
  end_offset INTEGER,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  embedding_model TEXT,
  embedding_updated_at TEXT,
  embedding_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  note_ids_json TEXT NOT NULL DEFAULT '[]',
  current_question_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS interview_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category_id TEXT,
  note_ids_json TEXT NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  asked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS interview_foundation_usage (
  foundation_key TEXT PRIMARY KEY,
  category_id TEXT,
  note_id TEXT NOT NULL,
  attachment_id TEXT,
  source_type TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1,
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_answer_evaluations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  knowledge_base_score REAL NOT NULL,
  knowledge_base_max_score REAL NOT NULL,
  knowledge_base_comment TEXT NOT NULL,
  knowledge_base_improvement_tip TEXT NOT NULL,
  knowledge_base_corrected_answer TEXT,
  knowledge_base_is_strong_answer INTEGER NOT NULL DEFAULT 0,
  general_knowledge_score REAL NOT NULL,
  general_knowledge_max_score REAL NOT NULL,
  general_knowledge_comment TEXT NOT NULL,
  general_knowledge_improvement_tip TEXT NOT NULL,
  general_knowledge_corrected_answer TEXT,
  general_knowledge_is_strong_answer INTEGER NOT NULL DEFAULT 0,
  overall_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES interview_questions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  channel TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT,
  category_id TEXT,
  note_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS note_chunks_fts
USING fts5(
  chunk_id UNINDEXED,
  note_id UNINDEXED,
  category_id UNINDEXED,
  attachment_id UNINDEXED,
  source UNINDEXED,
  search_text,
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_note_chunks_ai
AFTER INSERT ON note_chunks
BEGIN
  INSERT INTO note_chunks_fts (
    chunk_id,
    note_id,
    category_id,
    attachment_id,
    source,
    search_text
  ) VALUES (
    new.id,
    new.note_id,
    new.category_id,
    new.attachment_id,
    new.source,
    new.search_text
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_note_chunks_ad
AFTER DELETE ON note_chunks
BEGIN
  DELETE FROM note_chunks_fts
  WHERE chunk_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_note_chunks_au
AFTER UPDATE ON note_chunks
BEGIN
  DELETE FROM note_chunks_fts
  WHERE chunk_id = old.id;

  INSERT INTO note_chunks_fts (
    chunk_id,
    note_id,
    category_id,
    attachment_id,
    source,
    search_text
  ) VALUES (
    new.id,
    new.note_id,
    new.category_id,
    new.attachment_id,
    new.source,
    new.search_text
  );
END;

CREATE INDEX IF NOT EXISTS idx_categories_sort_order
  ON categories(sort_order ASC, name ASC);

CREATE INDEX IF NOT EXISTS idx_notes_category_id
  ON notes(category_id);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at
  ON notes(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_note_id
  ON attachments(note_id);

CREATE INDEX IF NOT EXISTS idx_attachments_category_id
  ON attachments(category_id);

CREATE INDEX IF NOT EXISTS idx_attachments_processing_status
  ON attachments(processing_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_chunks_note_id
  ON note_chunks(note_id);

CREATE INDEX IF NOT EXISTS idx_note_chunks_attachment_id
  ON note_chunks(attachment_id);

CREATE INDEX IF NOT EXISTS idx_note_chunks_category_id
  ON note_chunks(category_id);

CREATE INDEX IF NOT EXISTS idx_note_chunks_source
  ON note_chunks(source, category_id, note_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_chunks_unique_source
  ON note_chunks(note_id, COALESCE(attachment_id, ''), source, chunk_index);

CREATE INDEX IF NOT EXISTS idx_note_chunks_embedding_status
  ON note_chunks(embedding_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_started_at
  ON interview_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_category_id
  ON interview_sessions(category_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_questions_session_id
  ON interview_questions(session_id);

CREATE INDEX IF NOT EXISTS idx_interview_foundation_usage_note_id
  ON interview_foundation_usage(note_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_foundation_usage_category_id
  ON interview_foundation_usage(category_id, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_interview_answer_evaluations_session_id
  ON interview_answer_evaluations(session_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_occurred_at
  ON ai_usage_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_provider_channel
  ON ai_usage_events(provider, channel, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_task
  ON ai_usage_events(task, occurred_at DESC);
