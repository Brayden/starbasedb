// Import the native Node libraries for connecting to various databases
import { Client as PgClient } from 'pg'
import { createConnection as createMySqlConnection } from 'mysql2'
import { createClient as createTursoConnection } from '@libsql/client/web'

// Import how we interact with the databases through the Outerbase SDK
import {
    CloudflareD1Connection,
    MongoDBConnection,
    MySQLConnection,
    PostgreSQLConnection,
    StarbaseConnection,
    TursoConnection,
} from '@outerbase/sdk'
import { DataSource, Source } from './types'
import { Handler, HandlerConfig } from './handler'
import { MongoClient } from 'mongodb'
import { afterQueryCache, beforeQueryCache } from './cache'
import { isQueryAllowed } from './allowlist'
import { applyRLS } from './rls'

let globalConnection: any = null

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[]
    isTransaction: boolean
    isRaw: boolean
    resolve: (value: any) => void
    reject: (reason?: any) => void
}

export type RawQueryResponse = {
    columns: string[]
    rows: any[]
    meta: {
        rows_read: number
        rows_written: number
    }
}

export type QueryResponse = any[] | RawQueryResponse

export type ConnectionDetails = {
    database: any
    defaultSchema: string
}

async function beforeQuery(
    sql: string,
    params?: any[],
    dataSource?: DataSource,
    config?: HandlerConfig
): Promise<{ sql: string; params?: any[] }> {
    // ## DO NOT REMOVE: PRE QUERY HOOK ##

    return {
        sql,
        params,
    }
}

async function afterQuery(
    sql: string,
    result: any,
    isRaw: boolean,
    dataSource?: DataSource,
    config?: HandlerConfig
): Promise<any> {
    result = isRaw ? transformRawResults(result, 'from') : result

    // ## DO NOT REMOVE: POST QUERY HOOK ##

    return isRaw ? transformRawResults(result, 'to') : result
}

function transformRawResults(
    result: any,
    direction: 'to' | 'from'
): Record<string, any> {
    if (direction === 'from') {
        // Convert our result from the `raw` output to a traditional object
        result = {
            ...result,
            rows: result.rows.map((row: any) =>
                result.columns.reduce(
                    (obj: any, column: string, index: number) => {
                        obj[column] = row[index]
                        return obj
                    },
                    {}
                )
            ),
        }

        return result.rows
    } else if (direction === 'to') {
        // Convert our traditional object to the `raw` output format
        const columns = Object.keys(result[0] || {})
        const rows = result.map((row: any) => columns.map((col) => row[col]))

        return {
            columns,
            rows,
            meta: {
                rows_read: rows.length,
                rows_written: 0,
            },
        }
    }

    return result
}

// Outerbase API supports more data sources than can be supported via Cloudflare Workers. For those data
// sources we recommend you connect your database to Outerbase and provide the bases API key for queries
// to be made. Otherwise, for supported data sources such as Postgres, MySQL, D1, StarbaseDB, Turso and Mongo
// we can connect to the database directly and remove the additional hop to the Outerbase API.
async function executeExternalQuery(
    sql: string,
    params: any,
    isRaw: boolean,
    dataSource: DataSource,
    config?: HandlerConfig
): Promise<any> {
    if (!dataSource.externalConnection) {
        throw new Error('External connection not found.')
    }

    // If not an Outerbase API request, forward to external database.
    if (!config?.outerbaseApiKey) {
        return await executeSDKQuery(sql, params, isRaw, dataSource, config)
    }

    // Convert params from array to object if needed
    let convertedParams = params
    if (Array.isArray(params)) {
        let paramIndex = 0
        convertedParams = params.reduce(
            (acc, value, index) => ({
                ...acc,
                [`param${index}`]: value,
            }),
            {}
        )
        sql = sql.replace(/\?/g, () => `:param${paramIndex++}`)
    }

    const API_URL = 'https://app.outerbase.com'
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
    })

    const results: any = await response.json()
    return results.response.results?.items
}

export async function executeQuery(
    sql: string,
    params: any | undefined,
    isRaw: boolean,
    dataSource?: DataSource,
    config?: HandlerConfig
): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    try {
        // If the allowlist feature is enabled, we should verify the query is allowed before proceeding.
        await isQueryAllowed(
            sql,
            config?.enableAllowlist ?? false,
            dataSource,
            config
        )

        // If the row level security feature is enabled, we should apply our policies to this SQL statement.
        sql = await applyRLS(
            sql,
            config?.enableRls ?? false,
            config?.externalDbType,
            dataSource,
            config
        )

        // Run the beforeQuery hook for any third party logic to be applied before execution.
        const { sql: updatedSQL, params: updatedParams } = await beforeQuery(
            sql,
            params,
            dataSource,
            config
        )

        // If the query was modified by RLS then we determine it isn't currently a valid candidate
        // for caching. In the future we will support queries impacted by RLS and caching their
        // results.
        if (!isRaw) {
            // If a cached version of this query request exists, this function will fetch the cached results.
            const cache = await beforeQueryCache(
                updatedSQL,
                updatedParams,
                dataSource,
                config?.externalDbType
            )
            if (cache) {
                return cache
            }
        }

        let response

        if (dataSource.source === 'internal') {
            response =
                await dataSource.internalConnection?.durableObject.executeQuery(
                    updatedSQL,
                    updatedParams,
                    isRaw
                )
        } else {
            response = await executeExternalQuery(
                updatedSQL,
                updatedParams,
                isRaw,
                dataSource,
                config
            )
        }

        // If this is a cacheable query, this function will handle that logic.
        if (!isRaw) {
            await afterQueryCache(sql, updatedParams, response, dataSource)
        }

        return await afterQuery(updatedSQL, response, isRaw, dataSource, config)
    } catch (error: any) {
        throw new Error(error.message ?? 'An error occurred')
    }
}

export async function executeTransaction(
    queries: { sql: string; params?: any[] }[],
    isRaw: boolean,
    dataSource?: DataSource,
    config?: HandlerConfig
): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    const results = []

    for (const query of queries) {
        const result = await executeQuery(
            query.sql,
            query.params,
            isRaw,
            dataSource,
            config
        )
        results.push(result)
    }

    return results
}

async function createSDKPostgresConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new PostgreSQLConnection(
        new PgClient({
            host: config.externalDbHost,
            port: Number(config.externalDbPort),
            user: config.externalDbUser,
            password: config.externalDbPassword,
            database: config.externalDbName,
        })
    )

    return {
        database: client,
        defaultSchema: config.externalDbDefaultSchema || 'public',
    }
}

async function createSDKMySQLConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new MySQLConnection(
        createMySqlConnection({
            host: config.externalDbHost,
            port: Number(config.externalDbPort),
            user: config.externalDbUser,
            password: config.externalDbPassword,
            database: config.externalDbName,
        })
    )

    return {
        database: client,
        defaultSchema: config.externalDbDefaultSchema || 'public',
    }
}

async function createSDKMongoConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new MongoDBConnection(
        new MongoClient(config.externalDbMongodbUri as string),
        config.externalDbName as string
    )

    return {
        database: client,
        defaultSchema: config.externalDbName || '',
    }
}

async function createSDKTursoConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new TursoConnection(
        createTursoConnection({
            url: config.externalDbTursoUri || '',
            authToken: config.externalDbTursoToken || '',
        })
    )

    return {
        database: client,
        defaultSchema: config.externalDbDefaultSchema || 'main',
    }
}

async function createSDKCloudflareConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new CloudflareD1Connection({
        apiKey: config.externalDbCloudflareApiKey as string,
        accountId: config.externalDbCloudflareAccountId as string,
        databaseId: config.externalDbCloudflareDatabaseId as string,
    })

    return {
        database: client,
        defaultSchema: config.externalDbDefaultSchema || 'main',
    }
}

async function createSDKStarbaseConnection(
    config: HandlerConfig
): Promise<ConnectionDetails> {
    const client = new StarbaseConnection({
        apiKey: config.externalDbStarbaseUri as string,
        url: config.externalDbStarbaseToken as string,
    })

    return {
        database: client,
        defaultSchema: config.externalDbDefaultSchema || 'main',
    }
}

export async function executeSDKQuery(
    sql: string,
    params: any | undefined,
    isRaw: boolean,
    dataSource?: DataSource,
    config?: HandlerConfig
): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    // Initialize connection if it doesn't exist
    if (!globalConnection) {
        if (config?.externalDbType === 'postgres') {
            const { database } = await createSDKPostgresConnection(config)
            globalConnection = database
        } else if (config?.externalDbType === 'mysql' && config) {
            const { database } = await createSDKMySQLConnection(config)
            globalConnection = database
        } else if (config?.externalDbType === 'mongo' && config) {
            const { database } = await createSDKMongoConnection(config)
            globalConnection = database
        } else if (
            config?.externalDbType === 'sqlite' &&
            config?.externalDbCloudflareApiKey &&
            config
        ) {
            const { database } = await createSDKCloudflareConnection(config)
            globalConnection = database
        } else if (
            config?.externalDbType === 'sqlite' &&
            config?.externalDbStarbaseUri &&
            config
        ) {
            const { database } = await createSDKStarbaseConnection(config)
            globalConnection = database
        } else if (
            config?.externalDbType === 'sqlite' &&
            config?.externalDbTursoUri &&
            config
        ) {
            const { database } = await createSDKTursoConnection(config)
            globalConnection = database
        }

        await globalConnection.connect()
    }

    const { data } = await globalConnection.raw(sql, params)
    return data
}
