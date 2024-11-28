// Import the native Node libraries for connecting to various databases
import { Client as PgClient } from 'pg';
import { createConnection as createMySqlConnection } from 'mysql2';
import { createClient as createTursoConnection } from '@libsql/client/web';

// Import how we interact with the databases through the Outerbase SDK
import { CloudflareD1Connection, MongoDBConnection, MySQLConnection, PostgreSQLConnection, StarbaseConnection, TursoConnection } from '@outerbase/sdk';
import { DataSource } from '.';
import { Env } from './'
import { MongoClient } from 'mongodb';

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[];
    isTransaction: boolean;
    isRaw: boolean;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

export type RawQueryResponse = {
    columns: string[];
    rows: any[];
    meta: {
        rows_read: number;
        rows_written: number;
    }
}

export type QueryResponse = any[] | RawQueryResponse;

export type ConnectionDetails = {
    database: any,
    defaultSchema: string,
}

async function afterQuery(sql: string, result: any, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<any> {
    // ## DO NOT REMOVE: TEMPLATE POST-QUERY HOOK ##
    
    return result;
}

function cleanseQuery(sql: string): string {
    return sql.replaceAll('\n', ' ')
}

// Outerbase API supports more data sources than can be supported via Cloudflare Workers. For those data
// sources we recommend you connect your database to Outerbase and provide the bases API key for queries
// to be made. Otherwise, for supported data sources such as Postgres, MySQL, D1, StarbaseDB, Turso and Mongo
// we can connect to the database directly and remove the additional hop to the Outerbase API.
async function executeExternalQuery(sql: string, params: any, isRaw: boolean, dataSource: DataSource, env?: Env): Promise<any> {
    if (!dataSource.externalConnection) {
        throw new Error('External connection not found.');
    }

    // If not an Outerbase API request, forward to external database.
    if (!env?.OUTERBASE_API_KEY) {
        return await executeSDKQuery(sql, params, isRaw, dataSource, env);
    }

    // Convert params from array to object if needed
    let convertedParams = params;
    if (Array.isArray(params)) {
        let paramIndex = 0;
        convertedParams = params.reduce((acc, value, index) => ({
            ...acc,
            [`param${index}`]: value
        }), {});
        sql = sql.replace(/\?/g, () => `:param${paramIndex++}`);
    }

    const API_URL = 'https://app.outerbase.com';
    const response = await fetch(`${API_URL}/api/v1/ezql/raw`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Source-Token': dataSource.externalConnection.outerbaseApiKey,
        },
        body: JSON.stringify({
            query: cleanseQuery(sql),
            params: convertedParams,
        }),
    });

    const results: any = await response.json();
    const items = results.response.results?.items;
    return await afterQuery(sql, items, isRaw, dataSource, env);
}

export async function executeQuery(sql: string, params: any | undefined, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    if (dataSource.source === 'internal') {
        const response = await dataSource.internalConnection?.durableObject.executeQuery(sql, params, isRaw);
        return await afterQuery(sql, response, isRaw, dataSource, env);
    } else {
        return executeExternalQuery(sql, params, isRaw, dataSource, env);
    }
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }
    
    if (dataSource.source === 'internal') {
        const results: any[] = [];

        for (const query of queries) {
            const result = await dataSource.internalConnection?.durableObject.executeTransaction(queries, isRaw);
            if (result) {
                const processedResults = await Promise.all(
                    result.map(r => afterQuery(query.sql, r, isRaw, dataSource, env))
                );
                results.push(...processedResults);
            }
        }
        
        return results;
    } else {
        const results = [];

        for (const query of queries) {
            const result = await executeExternalQuery(query.sql, query.params, isRaw, dataSource, env);
            results.push(result);
        }
        
        return results;
    }
}

async function createSDKPostgresConnection(env: Env): Promise<ConnectionDetails> {
    const client = new PostgreSQLConnection(
        new PgClient({
            host: env.EXTERNAL_DB_HOST,
            port: Number(env.EXTERNAL_DB_PORT),
            user: env.EXTERNAL_DB_USER,
            password: env.EXTERNAL_DB_PASS,
            database: env.EXTERNAL_DB_DATABASE
        })
    );

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA || 'public'
    }
}

async function createSDKMySQLConnection(env: Env): Promise<ConnectionDetails> {
    const client = new MySQLConnection(
        createMySqlConnection({
            host: env.EXTERNAL_DB_HOST,
            port: Number(env.EXTERNAL_DB_PORT),
            user: env.EXTERNAL_DB_USER,
            password: env.EXTERNAL_DB_PASS,
            database: env.EXTERNAL_DB_DATABASE,
        })
    );

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA || 'public'
    }
}

async function createSDKMongoConnection(env: Env): Promise<ConnectionDetails> {
    const client = new MongoDBConnection(
        new MongoClient(env.EXTERNAL_DB_MONGODB_URI as string),
        env.EXTERNAL_DB_DATABASE as string
    );

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DATABASE || ''
    }
}

async function createSDKTursoConnection(env: Env): Promise<ConnectionDetails> {
    const client = new TursoConnection(createTursoConnection({ 
        url: env.EXTERNAL_DB_TURSO_URI || '',
        authToken: env.EXTERNAL_DB_TURSO_TOKEN || ''
    }));

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA || 'main'
    }
}

async function createSDKCloudflareConnection(env: Env): Promise<ConnectionDetails> {
    const client = new CloudflareD1Connection({
        apiKey: env.EXTERNAL_DB_CLOUDFLARE_API_KEY as string,
        accountId: env.EXTERNAL_DB_CLOUDFLARE_ACCOUNT_ID as string,
        databaseId: env.EXTERNAL_DB_CLOUDFLARE_DATABASE_ID as string,
    });

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA || 'main'
    }
}

async function createSDKStarbaseConnection(env: Env): Promise<ConnectionDetails> {
    const client = new StarbaseConnection({
        apiKey: env.EXTERNAL_DB_STARBASEDB_URI as string,
        url: env.EXTERNAL_DB_STARBASEDB_TOKEN as string,
    });

    return {
        database: client,
        defaultSchema: env.EXTERNAL_DB_DEFAULT_SCHEMA || 'main'
    }
}

export async function executeSDKQuery(sql: string, params: any | undefined, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }
    
    let db;
    
    if (env?.EXTERNAL_DB_TYPE === 'postgres') {
        const { database } = await createSDKPostgresConnection(env)
        db = database
    } else if (env?.EXTERNAL_DB_TYPE === 'mysql' && env) {
        const { database } = await createSDKMySQLConnection(env)
        db = database
    } else if (env?.EXTERNAL_DB_TYPE === 'mongo' && env) {
        const { database } = await createSDKMongoConnection(env)
        db = database
    } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_CLOUDFLARE_API_KEY && env) {
        const { database } = await createSDKCloudflareConnection(env)
        db = database
    } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_STARBASEDB_URI && env) {
        const { database } = await createSDKStarbaseConnection(env)
        db = database
    } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_TURSO_URI && env) {
        const { database } = await createSDKTursoConnection(env)
        db = database
    }

    await db.connect();
    const { data } = await db.raw(sql, params);
    
    return await afterQuery(sql, data, isRaw, dataSource, env);
}