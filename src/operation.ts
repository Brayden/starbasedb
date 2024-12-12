// Import the native Node libraries for connecting to various databases
import { Client as PgClient } from 'pg';
import { createConnection as createMySqlConnection } from 'mysql2';
import { createClient as createTursoConnection } from '@libsql/client/web';

// Import how we interact with the databases through the Outerbase SDK
import { CloudflareD1Connection, MongoDBConnection, MySQLConnection, PostgreSQLConnection, StarbaseConnection, TursoConnection } from '@outerbase/sdk';
import { DataSource } from './types';
import { Env } from './'
import { MongoClient } from 'mongodb';
import { afterQueryCache, beforeQueryCache } from './cache';

let globalConnection: any = null;

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

async function beforeQuery(sql: string, params?: any[], dataSource?: DataSource, env?: Env): Promise<{ sql: string, params?: any[] }> {
    // ## DO NOT REMOVE: PRE QUERY HOOK ##
    
    return {
        sql,
        params
    }
}

async function afterQuery(sql: string, result: any, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<any> {
    result = isRaw ? transformRawResults(result, 'from') : result;

    // ## DO NOT REMOVE: POST QUERY HOOK ##

    return isRaw ? transformRawResults(result, 'to') : result;
}

function transformRawResults(result: any, direction: 'to' | 'from'): Record<string, any> {
    if (direction === 'from') {
        // Convert our result from the `raw` output to a traditional object
        result = {
            ...result,
            rows: result.rows.map((row: any) => 
                result.columns.reduce((obj: any, column: string, index: number) => {
                    obj[column] = row[index];
                    return obj;
                }, {})
            )
        };

        return result.rows
    } else if (direction === 'to') {
        // Convert our traditional object to the `raw` output format
        const columns = Object.keys(result[0] || {});
        const rows = result.map((row: any) => columns.map(col => row[col]));
        
        return {
            columns,
            rows,
            meta: {
                rows_read: rows.length,
                rows_written: 0
            }
        };
    }
    
    return result
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
            query: sql.replaceAll('\n', ' '),
            params: convertedParams,
        }),
    });

    const results: any = await response.json();
    return results.response.results?.items;
}

export async function executeQuery(sql: string, params: any | undefined, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    const { sql: updatedSQL, params: updatedParams } = await beforeQuery(sql, params, dataSource, env)

    // If a cached version of this query request exists, this function will fetch the cached results.
    const cache = await beforeQueryCache(updatedSQL, updatedParams, dataSource)
    if (cache) {
        return cache
    }

    let response;

    if (dataSource.source === 'internal') {
        response = await dataSource.internalConnection?.durableObject.executeQuery(updatedSQL, updatedParams, isRaw);
    } else {
        response = await executeExternalQuery(updatedSQL, updatedParams, isRaw, dataSource, env);
    }

    // If this is a cacheable query, this function will handle that logic.
    await afterQueryCache(sql, updatedParams, response, dataSource)

    return await afterQuery(updatedSQL, response, isRaw, dataSource, env);
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }
    
    const results = [];

    for (const query of queries) {
        const result = await executeQuery(query.sql, query.params, isRaw, dataSource, env);
        results.push(result);
    }
    
    return results;
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
    
    // Initialize connection if it doesn't exist
    if (!globalConnection) {
        if (env?.EXTERNAL_DB_TYPE === 'postgres') {
            const { database } = await createSDKPostgresConnection(env)
            globalConnection = database;
        } else if (env?.EXTERNAL_DB_TYPE === 'mysql' && env) {
            const { database } = await createSDKMySQLConnection(env)
            globalConnection = database;
        } else if (env?.EXTERNAL_DB_TYPE === 'mongo' && env) {
            const { database } = await createSDKMongoConnection(env)
            globalConnection = database;
        } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_CLOUDFLARE_API_KEY && env) {
            const { database } = await createSDKCloudflareConnection(env)
            globalConnection = database;
        } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_STARBASEDB_URI && env) {
            const { database } = await createSDKStarbaseConnection(env)
            globalConnection = database;
        } else if (env?.EXTERNAL_DB_TYPE === 'sqlite' && env?.EXTERNAL_DB_TURSO_URI && env) {
            const { database } = await createSDKTursoConnection(env)
            globalConnection = database;
        }
        
        await globalConnection.connect();
    }

    const { data } = await globalConnection.raw(sql, params);
    return data;
}