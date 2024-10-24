CREATE TABLE IF NOT EXISTS data_masking_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    masking_mode TEXT NOT NULL CHECK (masking_mode IN ('null', 'redact', 'random')),
    allow_list TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    
    -- Ensure we don't have duplicate rules for the same column
    UNIQUE(schema_name, table_name, column_name)
);

-- Add an index to improve lookup performance
CREATE INDEX idx_data_masking_lookup 
ON data_masking_rules(schema_name, table_name, column_name);
