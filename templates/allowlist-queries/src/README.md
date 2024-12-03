# Installation Guide
Follow the below steps to deploy the allowlist queries template into your existing
StarbaseDB instance. These steps will alter your StarbaseDB application logic so that
it includes capabilities for screening any SQL statement you try to execute against your
database through a StarbaseDB instance to verify it is in the approved query list.

## Step-by-step Instructions

### Execute SQL statements in `migration.sql` to create required tables
This will create the tables and constraints for user signup/login, and sessions. You can do this in the Studio user interface or by hitting your query endpoint in your StarbaseDB instance.

```sql
CREATE TABLE IF NOT EXISTS tmp_allowlist_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sql_statement TEXT NOT NULL
);
```

### Add service bindings to your StarbaseDB wrangler.toml
This will let your StarbaseDB instance know that we are deploying another Worker
and it should use that for our allowlist application routing logic.

```
[[services]]
binding = "ALLOWLIST"
service = "starbasedb_allowlist_queries"
entrypoint = "AllowlistQueriesEntrypoint"
```

### Add ALLOWLIST to Env interface in `./src/index.ts`
Updates your `./src/index.ts` inside your StarbaseDB project so that your project
can now have a proper type-safe way of calling functionality that exists in this
new Cloudflare Worker that handles allowlist checking.

```
ALLOWLIST: {
    isQueryAllowed(body: Record<string, any>): Promise<Response>;
}
```

### Add logic in default export in `./src/index.ts`
We want to add the following code after our PRE-HANDLER hooks comment block. This
is where we define any custom template actions that we want to execute before we 
continue to pass the request to our traditional handler that will be responsible
for querying data sources.

```
// ## DO NOT REMOVE: PRE-HANDLER HOOKS ##
// INSERT CODE HERE IF REQUIRED
if (source === Source.external) {
    const isQueryAllowed = await env.ALLOWLIST.isQueryAllowed(clonedRequest.body ? await clonedRequest.json() : {});
    if (!isQueryAllowed) {
        return createResponse(undefined, 'Query not allowed', 403);
    }
}
```

### Deploy template project to Cloudflare
Next, we will deploy our new allowlist query logic to a new Cloudflare Worker instance.
```
cd ./templates/allowlist-queries
npm i && npm run cf-typegen && npm run deploy
```

### Deploy updates in our main StarbaseDB
With all of the changes we have made to our StarbaseDB instance we can now deploy
the updates so that all of the new allowlist application logic can exist and
be accessible.
```
cd ../..
npm run cf-typegen && npm run deploy
```

**NOTE:** You will want to deploy your new service worker for allowlist queries before deploying updates to your StarbaseDB instance, because the StarbaseDB instance will rely on the allowlist worker being available (see the service bindings we added in the wrangler.toml file for reference).