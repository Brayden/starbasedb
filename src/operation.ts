import { DataSource } from '.';

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

async function afterQuery(sql: string, result: any, isRaw: boolean, dataSource?: DataSource): Promise<any> {
    // ## DO NOT REMOVE: TEMPLATE AFTER QUERY HOOK ##

    return result;
}

export async function executeQuery(sql: string, params: any | undefined, isRaw: boolean, dataSource?: DataSource): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }

    if (dataSource.source === 'internal') {
        const response = await dataSource.internalConnection?.durableObject.executeQuery(sql, params, isRaw);
        return response ?? [];
    } else {
        if (!dataSource.externalConnection) {
            throw new Error('External connection not found.');
        }

        const API_URL = 'https://app.outerbase.com'
        const response = await fetch(`${API_URL}/api/v1/ezql/raw`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Source-Token': dataSource.externalConnection.outerbaseApiKey,
            },
            body: JSON.stringify({
                query: sql,
                // Params does not support arrays, so we ensure we only pass them an object.
                params: Array.isArray(params) ? {} : params,
            }),
        })

        let results: any = await response.json();
        let items = results.response.results?.items;
        return this.afterQuery(sql, items, isRaw, dataSource);
    } 
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, dataSource?: DataSource): Promise<QueryResponse> {
    if (!dataSource) {
        console.error('Data source not found.')
        return []
    }
    
    if (dataSource.source === 'internal') {
        const response = await dataSource.internalConnection?.durableObject.executeTransaction(queries, isRaw);
        return response ?? [];
    } else {
        if (!dataSource.externalConnection) {
            throw new Error('External connection not found.');
        }

        const API_URL = 'https://app.outerbase.com';
        const results = [];

        for (const query of queries) {
            const response = await fetch(`${API_URL}/api/v1/ezql/raw`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Source-Token': dataSource.externalConnection.outerbaseApiKey,
                },
                body: JSON.stringify({
                    query: query.sql,
                    // Params does not support arrays, so we ensure we only pass them an object
                    params: Array.isArray(query.params) ? {} : query.params,
                }),
            });

            const result: any = await response.json();
            const items = result.response.results?.items;
            results.push(this.afterQuery(query.sql, items, isRaw, dataSource));
        }

        return results;
    }
}