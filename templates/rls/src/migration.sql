CREATE TABLE "main"."tmp_rls_policies"(
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "actions" TEXT NOT NULL CHECK(actions IN ('SELECT', 'UPDATE', 'INSERT', 'DELETE')), -- Actions to apply
    "schema" TEXT,            -- Schema, optional, to create policy on
    "table" TEXT NOT NULL,    -- Table to create policy on
    "column" TEXT NOT NULL,   -- Column to use as our check
    "value" TEXT NOT NULL,    -- Column must match this value or it fails
    "value_type" TEXT NOT NULL DEFAULT 'string', -- Type the "value" should be casted to (e.g. "string", "number", "query")
    "operator" TEXT DEFAULT '=' -- How the column value should match (e.g. "=", "<=")
)
