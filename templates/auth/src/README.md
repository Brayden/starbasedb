# Installation Guide
Follow the below steps to deploy the user authentication template into your existing
StarbaseDB instance. These steps will alter your StarbaseDB application logic so that
it includes capabilities for handling the routing of `/auth` routes to a new Cloudflare
Worker instance that will be deployed – which will handle all application logic for
user authentication.

## Step-by-step Instructions

### Add service bindings to your StarbaseDB wrangler.toml
This will let your StarbaseDB instance know that we are deploying another Worker
and it should use that for our authentication application routing logic.

```
[[services]]
binding = "AUTH"
service = "starbasedb_auth"
entrypoint = "AuthEntrypoint"
```

### Add AUTH to Env interface in `./src/index.ts`
Updates your `./src/index.ts` inside your StarbaseDB project so that your project
can now have a proper type-safe way of calling functionality that exists in this
new Cloudflare Worker that handles authentication.

```
AUTH: {
    handleAuth(pathname: string, verb: string, body: any): Promise<Response>;
}
```

### Add routing logic in default export in `./src/index.ts`
We will add the below block of code in our `export default` section of our
StarbaseDB so that we can pick up on any `/auth` routes and immediately redirect
them to the new Cloudflare Worker.

```
if (pathname.startsWith('/auth')) {
    const body = await request.json();
    return await env.AUTH.handleAuth(pathname, request.method, body);
}
```

### Execute SQL statements in `migration.sql` to create required tables
This will create the tables and constraints for user signup/login, and sessions
required for the authentication operations to succeed.

### Run typegen in main project
With our newly added service bindings in our StarbaseDB `wrangler.toml` file we can
now generate an updated typegen output so our project knows that `AUTH` exists.
```
npm run cf-typegen
```

### Deploy template project to Cloudflare
Next, we will deploy our new authentication logic to a new Cloudflare Worker instance.
```
cd ./templates/auth
npm run deploy
```

### Deploy updates in our main StarbaseDB
With all of the changes we have made to our StarbaseDB instance we can now deploy
the updates so that all of the new authentication application logic can exist and
be accessible.