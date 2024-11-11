import { DataSource, Source } from ".";
import { LiteREST } from "./literest";
import { executeQuery, executeTransaction } from "./operation";
import { createResponse, QueryRequest, QueryTransactionRequest } from "./utils";
import { Env } from './'
import { handleApiRequest } from "./api";
import { dumpDatabaseRoute } from "./export/dump";
import { exportTableToJsonRoute } from "./export/json";
import { exportTableToCsvRoute } from "./export/csv";
import { importDumpRoute } from "./import/dump";
import { importTableFromJsonRoute } from "./import/json";
import { importTableFromCsvRoute } from "./import/csv";

export class Handler {
    private liteREST?: LiteREST;
    private dataSource?: DataSource;

    constructor() { }

    public async handle(request: Request, dataSource: DataSource, env: Env): Promise<Response> {
        this.dataSource = dataSource;
        this.liteREST = new LiteREST(dataSource, env);
        const url = new URL(request.url);

        if (request.method === 'POST' && url.pathname === '/query/raw') {
            return this.queryRoute(request, true);
        } else if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request, false);
        } else if (url.pathname === '/socket') {
            return this.clientConnected();
        } else if (url.pathname.startsWith('/rest')) {
            return await this.liteREST.handleRequest(request);
        } else if (request.method === 'GET' && url.pathname === '/export/dump') {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }

            return dumpDatabaseRoute(this.dataSource);
        } else if (request.method === 'GET' && url.pathname.startsWith('/export/json/')) {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }

            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return exportTableToJsonRoute(tableName, this.dataSource);
        } else if (request.method === 'GET' && url.pathname.startsWith('/export/csv/')) {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }

            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return exportTableToCsvRoute(tableName, this.dataSource);
        } else if (request.method === 'POST' && url.pathname === '/import/dump') {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }

            return importDumpRoute(request, this.dataSource);
        } else if (request.method === 'POST' && url.pathname.startsWith('/import/json/')) {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }

            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return importTableFromJsonRoute(tableName, request, this.dataSource);
        } else if (request.method === 'POST' && url.pathname.startsWith('/import/csv/')) {
            if (this.dataSource.source === Source.external) {
                return createResponse(undefined, 'Function is only available for internal data source.', 400);
            }
            
            const tableName = url.pathname.split('/').pop();
            if (!tableName) {
                return createResponse(undefined, 'Table name is required', 400);
            }
            return importTableFromCsvRoute(tableName, request, this.dataSource);
        } else if (url.pathname.startsWith('/api')) {
            return await handleApiRequest(request);
        }

        return createResponse(undefined, 'Unknown operation', 400);
    }

    async queryRoute(request: Request, isRaw: boolean): Promise<Response> {
        try {
            const contentType = request.headers.get('Content-Type') || '';
            if (!contentType.includes('application/json')) {
                return createResponse(undefined, 'Content-Type must be application/json.', 400);
            }
    
            const { sql, params, transaction } = await request.json() as QueryRequest & QueryTransactionRequest;

            if (Array.isArray(transaction) && transaction.length) {
                const queries = transaction.map((queryObj: any) => {
                    const { sql, params } = queryObj;

                    if (typeof sql !== 'string' || !sql.trim()) {
                        throw new Error('Invalid or empty "sql" field in transaction.');
                    } else if (params !== undefined && !Array.isArray(params) && typeof params !== 'object') {
                        throw new Error('Invalid "params" field in transaction. Must be an array or object.');
                    }

                    return { sql, params };
                });

                const response = await executeTransaction(queries, isRaw, this.dataSource);
                return createResponse(response, undefined, 200);
            } else if (typeof sql !== 'string' || !sql.trim()) {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            } else if (params !== undefined && !Array.isArray(params) && typeof params !== 'object') {
                return createResponse(undefined, 'Invalid "params" field. Must be an array or object.', 400);
            }

            const response = await executeQuery(sql, params, isRaw, this.dataSource);
            return createResponse(response, undefined, 200);
        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, error || 'An unexpected error occurred.', 500);
        }
    }

    clientConnected() {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        server.accept();
        server.addEventListener('message', event => {
            const { sql, params, action } = JSON.parse(event.data as string);

            if (action === 'query') {
                const executeQueryWrapper = async () => {
                    const response = await executeQuery(sql, params, false, this.dataSource);
                    server.send(JSON.stringify(response));
                };
                executeQueryWrapper();
            }
        });

        return new Response(null, { status: 101, webSocket: client });
    }
}