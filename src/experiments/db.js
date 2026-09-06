// A/B test experiment persistence layer.
//
// Tables (added to GINA's main SQLite DB; uses existing getDB() singleton):
//   experiments(name PK, variants_json, traffic_split_json, status, created_at, stopped_at, description)
//   assignments(exp_name, user_id, variant, assigned_at) PK(exp_name, user_id)
//   metrics(exp_name, user_id, variant, metric_name, value REAL, recorded_at) INDEX(exp_name, metric_name)
//
// All writes are synchronous (better-sqlite3). Reads use prepared statements for hot paths.

import { getDB } from '../db/connection.js'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS experiments (
  name TEXT PRIMARY KEY,
  variants_json TEXT NOT NULL,
  traffic_split_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'stopped')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stopped_at TEXT,
  description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS assignments (
  exp_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (exp_name, user_id),
  FOREIGN KEY (exp_name) REFERENCES experiments(name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assignments_variant ON assignments(exp_name, variant);

CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exp_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (exp_name) REFERENCES experiments(name) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_metrics_exp_metric ON metrics(exp_name, metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_variant ON metrics(exp_name, metric_name, variant);
`

let schemaInitialized = false

function ensureSchema() {
  if (schemaInitialized) return
  const db = getDB()
  db.exec(SCHEMA_SQL)
  schemaInitialized = true
}

export function resetExperimentsSchemaForTest() {
  schemaInitialized = false
  try {
    const db = getDB()
    db.exec(`
      DROP TABLE IF EXISTS metrics;
      DROP TABLE IF EXISTS assignments;
      DROP TABLE IF EXISTS experiments;
    `)
  } catch (_) {
    // ignore
  }
}

function rowToExperiment(row) {
  if (!row) return null
  return {
    name: row.name,
    variants: JSON.parse(row.variants_json),
    trafficSplit: JSON.parse(row.traffic_split_json),
    status: row.status,
    createdAt: row.created_at,
    stoppedAt: row.stopped_at,
    description: row.description || ''
  }
}

export function insertExperiment({ name, variants, trafficSplit, description = '' }) {
  ensureSchema()
  const db = getDB()
  const stmt = db.prepare(`
    INSERT INTO experiments (name, variants_json, traffic_split_json, status, description)
    VALUES (?, ?, ?, 'running', ?)
  `)
  stmt.run(
    name,
    JSON.stringify(variants),
    JSON.stringify(trafficSplit),
    description
  )
  return getExperiment(name)
}

export function getExperiment(name) {
  ensureSchema()
  const db = getDB()
  const row = db.prepare('SELECT * FROM experiments WHERE name = ?').get(name)
  return rowToExperiment(row)
}

export function listExperiments() {
  ensureSchema()
  const db = getDB()
  return db.prepare('SELECT * FROM experiments ORDER BY created_at DESC').all().map(rowToExperiment)
}

export function setExperimentStatus(name, status) {
  ensureSchema()
  const db = getDB()
  if (status === 'stopped') {
    db.prepare(`UPDATE experiments SET status = ?, stopped_at = datetime('now') WHERE name = ?`).run(status, name)
  } else {
    db.prepare(`UPDATE experiments SET status = ?, stopped_at = NULL WHERE name = ?`).run(status, name)
  }
  return getExperiment(name)
}

export function deleteExperiment(name) {
  ensureSchema()
  const db = getDB()
  // FK ON DELETE CASCADE will clean assignments + metrics
  db.prepare('DELETE FROM experiments WHERE name = ?').run(name)
}

export function upsertAssignment({ expName, userId, variant }) {
  ensureSchema()
  const db = getDB()
  db.prepare(`
    INSERT OR REPLACE INTO assignments (exp_name, user_id, variant, assigned_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(expName, userId, variant)
}

export function getAssignment(expName, userId) {
  ensureSchema()
  const db = getDB()
  const row = db.prepare(`
    SELECT variant, assigned_at FROM assignments WHERE exp_name = ? AND user_id = ?
  `).get(expName, userId)
  return row ? { variant: row.variant, assignedAt: row.assigned_at } : null
}

export function countAssignmentsByVariant(expName) {
  ensureSchema()
  const db = getDB()
  return db.prepare(`
    SELECT variant, COUNT(*) AS n FROM assignments
    WHERE exp_name = ?
    GROUP BY variant
  `).all(expName)
}

export function insertMetric({ expName, userId, variant, metricName, value }) {
  ensureSchema()
  const db = getDB()
  db.prepare(`
    INSERT INTO metrics (exp_name, user_id, variant, metric_name, value)
    VALUES (?, ?, ?, ?, ?)
  `).run(expName, userId, variant, metricName, value)
}

export function fetchMetricsByVariant(expName, metricName) {
  ensureSchema()
  const db = getDB()
  return db.prepare(`
    SELECT variant, value FROM metrics
    WHERE exp_name = ? AND metric_name = ?
    ORDER BY recorded_at ASC
  `).all(expName, metricName)
}

export function fetchAggregatedMetrics(expName, metricName) {
  ensureSchema()
  const db = getDB()
  return db.prepare(`
    SELECT
      variant,
      COUNT(*) AS n,
      AVG(value) AS mean,
      MIN(value) AS min,
      MAX(value) AS max,
      SUM(value) AS sum
    FROM metrics
    WHERE exp_name = ? AND metric_name = ?
    GROUP BY variant
  `).all(expName, metricName)
}

export function listMetricNames(expName) {
  ensureSchema()
  const db = getDB()
  return db.prepare(`
    SELECT DISTINCT metric_name FROM metrics WHERE exp_name = ? ORDER BY metric_name
  `).all(expName).map(r => r.metric_name)
}
