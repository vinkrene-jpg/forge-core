import Database from "better-sqlite3";

const ddl = [
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS core_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    locked INTEGER NOT NULL DEFAULT 1,
    version TEXT NOT NULL DEFAULT '1.0.0'
  );`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    outcome TEXT NOT NULL DEFAULT 'allowed',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    tokens_in INTEGER,
    tokens_out INTEGER,
    cost_indication TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS backlog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    parent_task_id INTEGER,
    title TEXT NOT NULL,
    goal TEXT,
    scope TEXT,
    risk TEXT NOT NULL DEFAULT 'low',
    owner_agent TEXT NOT NULL DEFAULT 'planner',
    status TEXT NOT NULL DEFAULT 'draft',
    acceptance_criteria TEXT,
    blocked_reason TEXT,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    task_id INTEGER,
    title TEXT NOT NULL,
    rationale TEXT,
    made_by TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS risks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    mitigation TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS modules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    purpose TEXT,
    version TEXT NOT NULL DEFAULT '0.1.0',
    status TEXT NOT NULL DEFAULT 'draft',
    active INTEGER NOT NULL DEFAULT 0,
    dependencies TEXT NOT NULL DEFAULT '[]',
    owner_agent TEXT NOT NULL DEFAULT 'module-manager',
    risk_level TEXT NOT NULL DEFAULT 'low',
    test_status TEXT NOT NULL DEFAULT 'untested',
    install_status TEXT NOT NULL DEFAULT 'not_installed',
    rollback_info TEXT,
    manifest TEXT,
    touches_core INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS module_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    data TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS sandboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER,
    name TEXT NOT NULL,
    purpose TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    test_status TEXT NOT NULL DEFAULT 'untested',
    storage_path TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sandbox_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sandbox_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS test_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER,
    sandbox_id INTEGER,
    types TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    results TEXT,
    passed INTEGER,
    failed INTEGER,
    mode TEXT NOT NULL DEFAULT 'static',
    module_version TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
    FOREIGN KEY (sandbox_id) REFERENCES sandboxes(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS test_run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_run_id INTEGER NOT NULL,
    step TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'review',
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    decided_by TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS guardian_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    findings TEXT NOT NULL DEFAULT '[]',
    reviewer TEXT NOT NULL DEFAULT 'rules',
    summary TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS governor_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id INTEGER NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT NOT NULL,
    inputs TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS memory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    task_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
  );`,
  `CREATE TABLE IF NOT EXISTS improvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem TEXT NOT NULL,
    cause TEXT,
    proposed_module TEXT,
    expected_improvement TEXT,
    risk TEXT NOT NULL DEFAULT 'low',
    priority TEXT NOT NULL DEFAULT 'medium',
    required_tests TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  `CREATE TABLE IF NOT EXISTS daily_loop_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'running',
    report TEXT,
    tasks_created INTEGER,
    approvals_requested INTEGER,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`,
  `CREATE INDEX IF NOT EXISTS idx_memory_items_category ON memory_items(category);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_calls_created_at ON ai_calls(created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_modules_status ON modules(status);`,
  `CREATE INDEX IF NOT EXISTS idx_test_runs_module_id ON test_runs(module_id);`,
];

export function bootstrapSqliteSchema(filePath: string): void {
  const sqlite = new Database(filePath);
  try {
    for (const statement of ddl) {
      sqlite.exec(statement);
    }
  } finally {
    sqlite.close();
  }
}
