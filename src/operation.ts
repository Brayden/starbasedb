import { DataSource } from '.';
import { Env } from './'

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

async function afterQuery(sql: string, result: any, isRaw: boolean, dataSource?: DataSource, env?: Env): Promise<any> {
    // ## DO NOT REMOVE: TEMPLATE AFTER QUERY HOOK ##

    return result;
}

function cleanseQuery(sql: string): string {
    return sql.replaceAll('\n', ' ')
}

 // NOTE: This is a temporary stop-gap solution to connect to external data sources. Outerbase offers
 // an API to handle connecting to a large number of database types in a secure manner. However, the
 // goal here is to optimize on query latency from your data sources by connecting to them directly.
 // An upcoming update will move the Outerbase SDK to be used in StarbaseDB so this service can connect
// to those database types without being required to funnel requests through the Outerbase API.
async function executeExternalQuery(sql: string, params: any, isRaw: boolean, dataSource: DataSource, env?: Env): Promise<any> {
    if (!dataSource.externalConnection) {
        throw new Error('External connection not found.');
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