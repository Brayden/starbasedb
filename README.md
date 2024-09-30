<p align="center">
  <a href="https://starbasedb.com">
    <img alt="StarbaseDB – Scale-to-zero HTTP SQLite database" src="https://github.com/Brayden/starbasedb/blob/main/banner.png?raw=true" width="1280">
  </a>
</p>

<h1 align="center">StarbaseDB</h1>
<p align="center">
  <i>Open source, scale-to-zero, HTTP SQLite database built on top of <a href="https://developers.cloudflare.com/durable-objects/" target="_blank">Cloudflare Durable Objects</a>.</i>
</p>

<h2>📦 How to Deploy</h2>
<p>Deploying a new SQLite database instance to a Cloudflare Durable Object can be done in a matter of minutes:</p>

<ol>
  <li>Clone this repository:<br>
    <code>git clone git@github.com:Brayden/starbasedb.git</code>
  </li>
  <li>Update the <code>AUTHORIZATION_TOKEN</code> value in the <code>wrangler.toml</code> file to be a private value shared only with those who should have access to your database, treat it like an API token.</li>
  <li>Run the typegen command:<br>
    <code>npm run cf-typegen</code>
  </li>
  <li>Deploy your worker:<br>
    <code>npm run deploy</code>
  </li>
</ol>

<p>After your worker has been deployed, you'll receive a console message similar to the one below:</p>

<pre>
<code>
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
</code>
</pre>

<h2>🛠️ Executing Queries</h2>
<p>Start executing queries against your database with the following cURL commands:</p>

<h3>Create Table</h3>
<pre>
<code>
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "CREATE TABLE IF NOT EXISTS artist(artistid INTEGER PRIMARY KEY, artistname TEXT);"
}'
</code>
</pre>

<h3>Insert Values</h3>
<pre>
<code>
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "INSERT INTO artist (artistid, artistname) VALUES (123, '\''Alice'\''), (456, '\''Bob'\''), (789, '\''Charlie'\'');"
}'
</code>
</pre>

<h3>Retrieve Values</h3>
<pre>
<code>
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "SELECT * FROM artist;"
}'
</code>
</pre>

<h2>🤝 Contributing</h2>
<p>We welcome contributions! Please refer to our <a href="./CONTRIBUTING.md">Contribution Guide</a> for more details.</p>

<h2>🔧 Why Are We Building This?</h2>
<p>We want to give back to the community and make it simple to deploy your own scale-to-zero SQLite database. With the serverless architecture of durable objects, you can now have your application layer coexist on the same compute instance as your database.</p>

<h2>📄 License</h2>
<p>This project is licensed under the MIT license. See the <a href="./LICENSE.txt">LICENSE</a> file for more info.</p>

<h2>👥 Contributors</h2>
<p>
  <img align="left" src="https://contributors-img.web.app/image?repo=brayden/starbasedb" alt="Contributors"/>
</p>