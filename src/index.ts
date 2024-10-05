// index.ts

import { DurableObjectState } from "@cloudflare/workers-types";
import { createResponse, QueryRequest, QueryTransactionRequest } from './utils';
import { runBenchmark } from './benchmark'; // Import the benchmark function

const DURABLE_OBJECT_ID = 'sql-durable-object';

export class DatabaseDurableObject {
    private sql: any;

    constructor(private state: DurableObjectState, private env: Env) {
        this.sql = state.storage.sql;
    }

    // Function to determine if a query is read-only
    private isReadOnlyQuery(sql: string): boolean {
        const readOnlyCommands = ['SELECT', 'PRAGMA', 'EXPLAIN'];
        const trimmedSql = sql.trim().toUpperCase();
        // Remove any leading comments or whitespace
        const firstLine = trimmedSql.split('\n')[0].trim();
        return readOnlyCommands.some(command => firstLine.startsWith(command));
    }

    async queryRoute(request: Request): Promise<Response> {
        try {
            const contentType = request.headers.get('Content-Type') || '';
            if (!contentType.includes('application/json')) {
                return createResponse(undefined, 'Content-Type must be application/json.', 400);
            }

            const { sql, params, transaction } = await request.json() as QueryRequest & QueryTransactionRequest;

            let queries: { sql: string; params?: any[] }[];

            if (Array.isArray(transaction) && transaction.length) {
                queries = transaction.map((queryObj: QueryRequest) => {
                    if (typeof queryObj.sql !== 'string' || !queryObj.sql.trim()) {
                        throw new Error('Invalid or empty "sql" field in transaction.');
                    } else if (queryObj.params !== undefined && !Array.isArray(queryObj.params)) {
                        throw new Error('Invalid "params" field in transaction.');
                    }
                    return { sql: queryObj.sql, params: queryObj.params };
                });
            } else if (typeof sql === 'string' && sql.trim()) {
                queries = [{ sql, params }];
            } else {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            }

            let result: any;

            if (Array.isArray(transaction)) {
                // Transactions need to be serialized to maintain atomicity
                result = await this.state.blockConcurrencyWhile(async () => {
                    try {
                        return this.sql.transactionSync(() => {
                            const results = [];
                            for (const query of queries) {
                                const res = query.params && query.params.length
                                    ? this.sql.exec(query.sql, ...query.params)
                                    : this.sql.exec(query.sql);
                                results.push(res.toArray());
                            }
                            return results;
                        });
                    } catch (error) {
                        console.error('Transaction Error:', error);
                        throw new Error('Transaction failed: ' + error.message);
                    }
                });
            } else {
                const query = queries[0];
                const isReadOnly = this.isReadOnlyQuery(query.sql);

                if (isReadOnly) {
                    // Process read-only queries concurrently
                    try {
                        const res = query.params && query.params.length
                            ? this.sql.exec(query.sql, ...query.params)
                            : this.sql.exec(query.sql);
                        result = res.toArray();
                    } catch (error) {
                        console.error('Query Error:', error);
                        return createResponse(undefined, 'Query failed: ' + error.message, 500);
                    }
                } else {
                    // Serialize write operations
                    result = await this.state.blockConcurrencyWhile(async () => {
                        try {
                            const res = query.params && query.params.length
                                ? this.sql.exec(query.sql, ...query.params)
                                : this.sql.exec(query.sql);
                            return res.toArray();
                        } catch (error) {
                            console.error('Query Error:', error);
                            throw new Error('Query failed: ' + error.message);
                        }
                    });
                }
            }

            return createResponse(result, undefined, 200);

        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, 'An unexpected error occurred: ' + error.message, 500);
        }
    }

    async statusRoute(): Promise<Response> {
        try {
            const usedDisk = await this.sql.databaseSize;
            return createResponse({
                status: 'reachable',
                timestamp: Date.now(),
                usedDisk,
            }, undefined, 200);
        } catch (error: any) {
            console.error('Status Route Error:', error);
            return createResponse(undefined, 'Failed to retrieve status: ' + error.message, 500);
        }
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request);
        } else if (request.method === 'GET' && url.pathname === '/status') {
            return this.statusRoute();
        } else {
            return createResponse(undefined, 'Unknown operation', 400);
        }
    }
}

// Main fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/benchmark') {
      // Run the benchmark
      return await runBenchmark(env);
    }

    // Existing authorization logic
    if (request.headers.get('Authorization') !== `Bearer ${env.AUTHORIZATION_TOKEN}`) {
      return createResponse(undefined, 'Unauthorized request', 401);
    }

    const id = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
    const stub = env.DATABASE_DURABLE_OBJECT.get(id);

    return await stub.fetch(request);
  },
} as ExportedHandler<Env>;
