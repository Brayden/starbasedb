
Tests:
- `SELECT * FROM users WHERE name='Alice' OR 1=1`

```
[[services]]
binding = "RLS"
service = "starbasedb_rls"
entrypoint = "RLSEntrypoint"
```

```
RLS: {
    applyRLS(sql: string, dialect?: string): Promise<string | Error>
}
```

```
if (dataSource?.source === Source.external) {
    // For current use case, only applying allowlist rules to the external data source
    const isAllowed = await env?.ALLOWLIST.isQueryAllowed(sql);
    if (isAllowed instanceof Error) {
        throw Error(isAllowed.message)
    }

    const rls = await env?.RLS.applyRLS(sql, env?.EXTERNAL_DB_TYPE)
    if (rls !== undefined && !(rls instanceof Error)) {
        sql = rls
    }
}
```

Tests:

Basic SELECT Query	
`SELECT * FROM todos;`
-> Outcome: Returns only todos with selected userId
-> Expected: Returns only todos with selected userId

Basic INSERT Query	
`INSERT INTO todos (user_id, text) VALUES ('1', 'Test Task');`
X/? Outcome: Automatically overrides '1' value for the current users ID
-> Expected: Ideally would throw an unauthorized error to the user

Basic Unauthorized UPDATE Query	
`UPDATE todos SET text = 'Updated Task' WHERE id = 1;`
X/? Outcome: Returns as success but didn't actually update the value
-> Expected: Should return an unuathorized error

Basic Authorized UPDATE Query	
`UPDATE todos SET text = 'Updated Task' WHERE id = 9;`
-> Outcome: Should update the value
-> Expected: Should update the value

Basic Unauthorized DELETE Query	
`DELETE FROM todos WHERE id = 1;`
X/? Outcome: Returns as a success but does not actually delete the item
-> Expected: Should return an unauthorized error

Basic Authorized DELETE Query	
`DELETE FROM todos WHERE id = 9;`
-> Outcome: Returns as a success and deletes the row
-> Expected: Returns as a success and deletes the row

Action Denial	
`INSERT INTO todos (user_id, text) VALUES ('27', 'Should Fail');`
X/? Outcome: Returns a success and replaces '27' value for the current users ID
-> Expected: Should return an unauthorized error

Bypass Attempt	
`SELECT * FROM todos WHERE user_id = '123' OR 1=1;`
-> Outcome: Return only the users todos
-> Expected: Return only the users todos

Schema-Specific Query	
`SELECT * FROM my_schema.todos;`
-> Outcome: Return only the users todos
-> Expected: Return only the users todos

Unrelated Table Query	
`SELECT * FROM unrelated_table;`
-> Outcome: If no rules apply to it, then return all
-> Outcome: If rules apply to it, if rules don't meet criteria of policy then no results
-> Expected: Returns all with no rules, returns expected with rules

JOIN Query	
`SELECT todos.text, users.name FROM todos INNER JOIN users ON todos.user_id = users.id;`
-> Outcome: Results that match only the user_id
-> Expected: Results that match only the user_id

Subquery	
`SELECT * FROM todos WHERE id IN (SELECT id FROM todos WHERE user_id = '123');`
-> Outcome: Should not show any results
-> Expected: Should not show any results since user_id '123' does not match current user

CTE Query	
`WITH cte AS (SELECT * FROM todos WHERE user_id = '123') SELECT * FROM cte;`
-> Outcome: Returns no results since we are not user_id '123'
-> Expected: Should not return any results for users that are not of current ID

Empty Table Query	
`SELECT * FROM todos WHERE user_id = '123';`
-> Outcome: No results returned
-> Expected: No results returned

Ambiguous Columns Query	
`SELECT user_id FROM todos, users WHERE todos.user_id = users.id;`

Mixed Policies Query	
```
SELECT * FROM todos;
INSERT INTO todos (user_id, text) VALUES ('123', 'New Task');
UPDATE todos SET text = 'Updated Task' WHERE id = 1;
DELETE FROM todos WHERE id = 1;
```
-> Outcome: No results, referenced rows not affected, new row inserted
-> Expected: No results, referenced rows not affected, new row inserted

Syntax Error	
`SELECT FROM todos WHERE ;`
-> Outcome: Error
-> Expected: Error

Unsupported Dialect	
`Use SQL in a dialect that your implementation doesn’t support (e.g., MySQL with proprietary syntax).`

Missing Context Value	
`SELECT * FROM todos WHERE user_id = context.id();`
----> Currently fails. Should you have to declare a rule to be able to use context.id()? It only exists as a thing in our RLS plugin currently.

Large Dataset Query	
`SELECT * FROM todos;`
-> Outcome: Returns all todos
-> Expected: Returns all todos

High Concurrency	
`Simulate multiple concurrent queries (use the same SELECT * FROM todos; query).`
-> Outcome: Returns one set of results scoped to the current user ID
-> Expected: Returns one set of results scoped to the current user ID

SQL Injection	
`SELECT * FROM todos WHERE user_id = '123; DROP TABLE todos; --';`
-> Outcome: Returns an empty data set
-> Expected: Returns an empty data set

SQLite-Specific Query	
`SELECT name FROM sqlite_master WHERE type='table';`
-- We should automatically include this into rules table as a pre-saved INSERT statement somehow

PostgreSQL-Specific Query	
`SELECT * FROM information_schema.tables WHERE table_schema = 'public';`
-- We should automatically include this into rules table as a pre-saved INSERT statement somehow
