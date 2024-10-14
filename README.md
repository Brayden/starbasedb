<p align="center">
  <a href="https://starbasedb.com">
    <img alt="StarbaseDB – Scale-to-zero HTTP SQLite database" src="https://github.com/Brayden/starbasedb/blob/main/banner.png?raw=true" width="1280">
  </a>
</p>

<h1 align="center">StarbaseDB</h1>
<p align="center">
  <i>Open source, scale-to-zero, HTTP SQLite database built on top of <a href="https://developers.cloudflare.com/durable-objects/" target="_blank">Cloudflare Durable Objects</a>.</i>
</p>

<div align="center">
  <a href="https://github.com/Brayden/starbasedb/releases"><img src="https://img.shields.io/github/v/release/Brayden/starbasedb?display_name=tag&style=flat"></img></a>
  <a href="https://starbasedb.com"><img src="https://img.shields.io/static/v1?label=Website&message=StarbaseDB&color=%23be185d&style=flat"></img></a>
  <a href="https://twitter.com/BraydenWilmoth"><img src="https://img.shields.io/static/v1?label=Follow&message=@BraydenWilmoth&color=black&style=flat"></img></a>
  <a href="https://discord.gg/k2J7jcJCvd"><img src="https://img.shields.io/static/v1?label=Join us on&message=Discord&color=%237289da&style=flat"></img></a>
  <a href="https://outerbase.com"><img src="https://img.shields.io/static/v1?label=Check out&message=Outerbase&color=gray&style=flat"></img></a>
</div>

<br />
<h2>Features</h2>
<ul>
  <li><strong><a href="https://github.com/Brayden/starbasedb/edit/main/README.md#executing-queries">HTTPS Endpoints</a></strong> to query & interact with your database</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb?tab=readme-ov-file#web-sockets">Web Socket Connections</a></strong> to query your database with low-latency web sockets</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb?tab=readme-ov-file#transactions">Transactions Support</a></strong> for executing interdependent collections of queries</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb/blob/main/src/literest/README.md">REST API Support</a></strong> automatically included for interacting with your tables</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb/edit/main/README.md#deploy-a-starbasedb">Database Interface</a></strong> included out of the box deployed with your Cloudflare Worker</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb?tab=readme-ov-file#sql-dump">Export SQL Dump</a></strong> to extract your schema and data into a local `.sql` file</li>
  <li><strong><a href="https://github.com/Brayden/starbasedb?tab=readme-ov-file#sql-import">Import SQL Dump</a></strong> to import your schema and data from a local `.sql` file</li>
  <li><strong>Scale-to-zero Compute</strong> to reduce costs when your database is not in use</li>
</ul>
<br />
<p>Throughout building this offering we are documenting as much of the journey as possible. Join us in our adventure and join the conversation on talking through our design decisions as we continue to move fast. Find more details on how we implement core features <a href="https://starbasedb.com/blog/">on our blog</a>.</p>

<br />
<h2>Roadmap</h2>
<ul>
  <li><strong>Point in Time Rollbacks</strong> for rolling back your database to any minute in the past 30 days</li>
  <li><strong>Data Replication</strong> to scale reads beyond the 1,000 RPS limitation</li>
  <li><strong>Data Streaming</strong> for streaming responses back as rows are read</li>
  <li><strong>Data Syncing</strong> between local source and your database</li>
  <li><strong>Export Data</strong> as a CSV, JSON or SQLite file</li>
  <li><strong>Import Data</strong> from a CSV, JSON or SQLite file</li>
</ul>

<br />
<p>The above list is not an exhaustive list of features planned, but a glimpse at the direction we have in mind. We welcome any and all ideas from the community on what features or issues you would like to see be included as part of StarbaseDB. You can create new <a href="https://github.com/Brayden/starbasedb/issues/new?assignees=&labels=&projects=&template=bug_report.md&title=">Bug Reports</a> and <a href="https://github.com/Brayden/starbasedb/issues/new?assignees=&labels=&projects=&template=feature_request.md&title=">Feature Requests</a> and each will be reviewed.</p>

<br />
<h2>Deploy a StarbaseDB</h2>
<p>Deploying a new SQLite database instance to a Cloudflare Durable Object can be done via a single command:</p>

```bash
curl https://starbasedb.com/install.sh | bash
```

<p>
  The above command will create two new resources in your Cloudflare account, a Worker and a Durable Object.
  Your Worker will be what clients make network requests to for fetching data from your database, and the Durable
  Object itself is the SQLite storage.
</p>

<p>After your worker has been deployed, you'll receive a console message similar to the one below:</p>

<pre>
<code>
==========================================
Welcome to the StarbaseDB installation script!
 
This script will deploy a Cloudflare Worker and create an Outerbase Starlink session.
If you don't have a paid Cloudflare account, your deployment will fail.
 
IMPORTANT: You _MUST_ have a paid Cloudflare account to use SQLite in Durable Objects.
==========================================
 
Cloning the repository...
 
Please enter your Cloudflare account_id (from 'wrangler whoami' or the Cloudflare dashboard):
{{YOUR_ACCOUNT_ID}}
 
Deploying your worker...
Worker deployed successfully at https://starbasedb.{YOUR-IDENTIFIER}.workers.dev.
 
==========================================
 
Outerbase Studio user account created!
Use the following URL to view your database:

https://starbasedb.{YOUR-IDENTIFIER}.workers.dev/studio

Username: admin
Password: password

NOTE: You can change your Outerbase Studio password in the wrangler.toml file and redeploy.

==========================================
</code>
</pre>

<br />
<h2>Executing Queries</h2>
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
    "sql": "SELECT * FROM artist WHERE artistid=$1;",
    "params": [123]
}'
</code>
</pre>

<h3>Transactions</h3>
<pre>
<code>
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "transaction": [
        {
            "sql": "SELECT * FROM artist WHERE artistid=$1;",
            "params": [123]
        },
        {
            "sql": "SELECT * FROM artist;",
            "params": []
        }
    ]
}'
</code>
</pre>

<h3>Raw Query Response</h3>
<pre>
<code>
curl --location --request POST 'https://starbasedb.YOUR-ID-HERE.workers.dev/query/raw' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer ABC123' \
--data-raw '{
    "sql": "SELECT * FROM artist;",
    "params": []
}'
</code>
</pre>

<h3>Web Sockets</h3>
Below is an example HTML script function showing how you can connect via Web Sockets.

```javascript
let socket;

function connectWebSocket() {
    logMessage("Connecting to WebSocket...");
    
    socket = new WebSocket('wss://starbasedb.YOUR-ID-HERE.workers.dev/socket?token=ABC123');

    socket.onopen = function() {
        logMessage("WebSocket connection opened.");
    };

    socket.onmessage = function(event) {
        logMessage("Received: " + event.data);
    };

    socket.onclose = function(event) {
        logMessage(`WebSocket closed with code: ${event.code}, reason: ${event.reason}`);
    };

    socket.onerror = function(error) {
        logMessage("WebSocket error: " + error.message);
    };
}

function sendMessage() {
    const message = document.getElementById('messageInput').value;
    if (socket && socket.readyState === WebSocket.OPEN) {
        logMessage("Sending: " + message);

        socket.send(JSON.stringify({
            sql: message,
            params: [],
            action: 'query'
        }));
    } else {
        logMessage("WebSocket is not open.");
    }
}

window.onload = connectWebSocket;
```

<h3>SQL Dump</h3>
You can request a `database_dump.sql` file that exports your database schema and data into a single file.

<pre>
<code>
curl --location 'https://starbasedb.YOUR-ID-HERE.workers.dev/export/dump' \
--header 'Authorization: Bearer ABC123' 
--output database_dump.sql
</code>
</pre>

<h3>JSON Data Export</h3>
<pre>
<code>
curl
--location 'https://starbasedb.YOUR-ID-HERE.workers.dev/export/json/users' \
--header 'Authorization: Bearer ABC123'
--output output.json
</code>
</pre>

<h3>CSV Data Export</h3>
<pre>
<code>
curl
--location 'https://starbasedb.YOUR-ID-HERE.workers.dev/export/csv/users' \
--header 'Authorization: Bearer ABC123'
--output output.csv
</code>
</pre>

<h3>SQL Import</h3>
<pre>
<code>
curl 
--location 'https://starbasedb.YOUR-ID-HERE.workers.dev/import/dump' \
--header 'Authorization: Bearer ABC123' \
--form 'sqlFile=@"./Desktop/sqldump.sql"'
</code>
</pre>


<br />
<h2>Contributing</h2>
<p>We welcome contributions! Please refer to our <a href="./CONTRIBUTING.md">Contribution Guide</a> for more details.</p>

<br />
<h2>License</h2>
<p>This project is licensed under the MIT license. See the <a href="./LICENSE">LICENSE</a> file for more info.</p>

<br />
<h2>Contributors</h2>
<p>
  <img align="left" src="https://contributors-img.web.app/image?repo=brayden/starbasedb" alt="Contributors"/>
</p>
