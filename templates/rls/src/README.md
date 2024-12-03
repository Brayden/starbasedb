
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