# Installation Guide
Follow the below steps to deploy the dynamic data masking template into your existing
StarbaseDB instance. These steps will alter your StarbaseDB application logic so that
it includes capabilities for handling transforming data responses before they are sent
back to the client from the server.

## Step-by-step Instructions

### Execute SQL statements in `migration.sql` to create required tables
This will create the tables and constraints for user signup/login, and sessions. You can do this in the Studio user interface or by hitting your query endpoint in your StarbaseDB instance.

```sql
CREATE TABLE IF NOT EXISTS data_masking_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    masking_mode TEXT NOT NULL CHECK (masking_mode IN ('null', 'redact', 'random', 'remove')),
    created_at TEXT DEFAULT (datetime('now')),
    
    -- Ensure we don't have duplicate rules for the same column
    UNIQUE(schema_name, table_name, column_name)
);

-- Add an index to improve lookup performance
CREATE INDEX idx_data_masking_lookup 
ON data_masking_rules(schema_name, table_name, column_name);
```

This will let your StarbaseDB instance know that we are deploying another Worker
and it should use that for our authentication application routing logic.

```yaml
[[services]]
binding = "DATA_MASKING"
service = "starbasedb_data_masking"
entrypoint = "DataMaskingEntrypoint"
```

### Add DATA_MASKING to Env interface in `./src/index.ts`
Updates your `./src/index.ts` inside your StarbaseDB project so that your project
can now have a proper type-safe way of calling functionality that exists in this
new Cloudflare Worker that handles authentication.

```
DATA_MASKING: {
    maskQueryResult(sql: string, result: any, isRaw: boolean, maskingRules: any): Promise<any>;
}
```

### Add functionality into our afterQuery hook in `operation.ts`
Include two lines of code before the result is returned. It's important to use the `sqlInstance.exec` as a raw execution to the
database here so we do not recursively call our `maskQueryResult` operation. The SQL call must be made outside of our durable
object because of this restriction, since inside a bindable service we only have access to `executeExternalQuery` which would also
trigger the recursive calls.

```javascript
async function afterQuery(sql: string, result: any, isRaw: boolean, sqlInstance: any, env?: Env): Promise<any> {
    // ## DO NOT REMOVE: TEMPLATE AFTER QUERY HOOK ##
    const maskingRulesCursor = sqlInstance.exec('SELECT * FROM data_masking_rules')
    result = await env?.DATA_MASKING.maskQueryResult(sql, result, isRaw, maskingRulesCursor.toArray());

    return result;
}
```

### Deploy template project to Cloudflare
Next, we will deploy our new dynamic data masking logic to a new Cloudflare Worker instance.
```bash
cd ./templates/data-maski gn
npm i && npm run deploy
```

### Deploy updates in our main StarbaseDB
With all of the changes we have made to our StarbaseDB instance we can now deploy
the updates so that all of the new dynamic data masking application logic can exist and
be accessible.
```bash
cd ../..
npm run cf-typegen && npm run deploy
```

### Insert a masking rule into your database table
Open up your database UI and inside your `data_masking_rules` table add a new entry. Enter in the schema (e.g. "main", "public", etc), name of the table, column name to target, and masking mode. Masking mode can be either "null", "redact", "remove" or "random".

- "null" replaces all values with `null`
- "redact" replaces all values with `********`
- "remove" will cause the column to be stripped out of the response altogether
- "random" replaces all values with a random string

**NOTE:** You will want to deploy your new service worker for dynamic data masking before deploying updates to your StarbaseDB instance, because the StarbaseDB instance will rely on the data masking worker being available (see the service bindings we added in the wrangler.toml file for reference).