# StarbaseDB
StarbaseDB is an open source, scale-to-zero, HTTP SQLite database built on top of [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/).

## How to deploy
Deploying a new SQLite database instance to a Cloudflare Durable Object can be done in a matter of minutes.

1. Clone this repository
`git clone git@github.com:Brayden/starbasedb.git`
2. Update the `AUTHORIZATION_TOKEN` value in the `wrangler.toml` file to be a private value only shared with those who should have access to your database, treat it like an API token.
3. Run the typegen command `npm run cf-typegen` to update generated file output for your new authorization token value.
4. Run the deploy command `npm run deploy`

After your worker has been deployed, the console will respond with a message similar to the one shown below which includes a URL.

```
Total Upload: 4.59 KiB / gzip: 1.67 KiB
Your worker has access to the following bindings:
- Durable Objects:
  - DATABASE_DURABLE_OBJECT: DatabaseDurableObject
- Vars:
  - AUTHORIZATION_TOKEN: "ABC123"
Uploaded starbasedb (2.94 sec)
Deployed starbasedb triggers (0.20 sec)
  https://starbasedb.YOUR-ID-HERE.workers.dev
Current Version ID: d3e00de3-56b4-48b9-938d-a7cad57bb66a
```

## Executing Queries
Start executing queries against your database with the following cURL commands:

**Create Table**
```cURL
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "CREATE TABLE IF NOT EXISTS artist(artistid INTEGER PRIMARY KEY, artistname TEXT);"
}'
```

**Insert Values**
```cURL
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "INSERT INTO artist (artistid, artistname) VALUES (123, '\''Alice'\''), (456, '\''Bob'\''), (789, '\''Charlie'\'');"
}'
```

**Retrieve Values**
```cURL
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "SELECT * FROM artist;"
}'
```

## Contributing
Please refer to our [Contribution Guide](./CONTRIBUTING.md).

## Why are we building this?
We want to give back to the community and make it easily possible to deploy your own scale-to-zero SQLite database. With the serverless architecture of durable objects and how they work, you can now have your logical application layer co-exist on the same compute instance as your database.

## License
This project is licensed under the MIT license. See the [LICENSE](./LICENSE.txt) file for more info.

## Contributors
<img align="left" src="https://contributors-img.web.app/image?repo=brayden/starbasedb"/>
