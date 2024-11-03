import { DataSource, Source } from '.';
import { createResponse } from './utils';

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

export async function executeQuery(sql: string, params: any[] | undefined, isRaw: boolean, dataSource: DataSource): Promise<QueryResponse> {
    if (dataSource.source === 'internal') {
        const response = await dataSource.internalConnection?.durableObject.executeQuery(sql, params, isRaw);
        return response ?? [];
    } else {
        if (!dataSource.externalConnection) {
            throw new Error('External connection not found.');
        }

        // TODO: Can we try to handle `isRaw` here as well even though it's not supported by Outerbase?

        const API_URL = 'https://app.outerbase.com'
        const response = await fetch(`${API_URL}/api/v1/ezql/raw`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Source-Token': dataSource.externalConnection.outerbaseApiKey,
            },
            body: JSON.stringify({
                query: sql,
                params: params,
            }),
        })

        let results: any = await response.json();
        let items = results.response.results?.items;
        return items;
    } 
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, dataSource: DataSource): Promise<QueryResponse> {
    if (dataSource.source === 'internal') {
        const response = await dataSource.internalConnection?.durableObject.executeTransaction(queries, isRaw);
        return response ?? [];
    } else {
        if (!dataSource.externalConnection) {
            throw new Error('External connection not found.');
        }

        // TODO: Implement transaction for external source
    }

    return [];
}