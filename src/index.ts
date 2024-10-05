import { DurableObjectNamespace, DurableObjectState } from "@cloudflare/workers-types";
import { createResponse, QueryRequest, QueryTransactionRequest } from './utils';
import { enqueueOperation, OperationQueueItem } from './operation';

const DURABLE_OBJECT_ID = 'sql-durable-object';

export class DatabaseDurableObject {
    private sql: any;
    private operationQueue: Array<OperationQueueItem> = [];
    private workerPool: Set<Promise<void>> = new Set();
    private readonly maxWorkers = 10;

    constructor(private state: DurableObjectState, private env: Env) {
        this.sql = state.storage.sql;
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

            return await enqueueOperation(
                queries,
                Array.isArray(transaction),
                false,
                this.operationQueue,
                this.workerPool,
                this.maxWorkers,
                this.sql,
                this.state
            );
        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, 'An unexpected error occurred.', 500);
        }
    }

    async statusRoute(): Promise<Response> {
        return createResponse({
            status: 'reachable',
            timestamp: Date.now(),
            usedDisk: await this.sql.databaseSize,
        }, undefined, 200);
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

export default {
    fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
        if (request.headers.get('Authorization') !== `Bearer ${env.AUTHORIZATION_TOKEN}`) {
            return createResponse(undefined, 'Unauthorized request', 401);
        }

        const id = env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
        const stub = env.DATABASE_DURABLE_OBJECT.get(id);

        return await stub.fetch(request);
    }
} as ExportedHandler<Env>;
