import { DataSource, Source } from ".";
import { handleApiRequest } from "./api";
import { exportTableToCsvRoute } from "./export/csv";
import { dumpDatabaseRoute } from "./export/dump";
import { exportTableToJsonRoute } from "./export/json";
import { importTableFromCsvRoute } from "./import/csv";
import { importDumpRoute } from "./import/dump";
import { importTableFromJsonRoute } from "./import/json";
import { LiteREST } from "./literest";
import { executeQuery, OperationQueueItem } from "./operation";
import { createResponse, createResponseFromOperationResponse, QueryRequest, QueryTransactionRequest } from "./utils";

export class Handler {
    // Queue of operations to be processed, with each operation containing a list of queries to be executed
    private operationQueue: Array<OperationQueueItem> = [];

    // Flag to indicate if an operation is currently being processed
    private processingOperation: { value: boolean } = { value: false };

    // Map of WebSocket connections to their corresponding session IDs
    private connections = new Map<string, WebSocket>();

    // Instantiate LiteREST
    private liteREST?: LiteREST;

    private dataSource?: DataSource;

    // You can inject dependencies via the constructor if needed
    constructor(/* dependencies */) {
        // Initialize LiteREST for handling /lite routes
        // this.liteREST = new LiteREST(
        //     ctx,
        //     this.operationQueue,
        //     this.processingOperation,
        //     this.sql
        // );
    }

    // Main method to handle the request
    public async handle(request: Request, dataSource: DataSource): Promise<Response> {
        this.dataSource = dataSource;
        const url = new URL(request.url);

        // return createResponse(dataSource, undefined, 200);

        if (request.method === 'POST' && url.pathname === '/query/raw') {
            return this.queryRoute(request, true);
        } else if (request.method === 'POST' && url.pathname === '/query') {
            return this.queryRoute(request, false);
        } 
        // else if (url.pathname === '/socket') {
        //     return this.clientConnected();
        // } else if (url.pathname.startsWith('/rest')) {
        //     return await this.liteREST.handleRequest(request);
        // } else if (request.method === 'GET' && url.pathname === '/export/dump') {
        //     return dumpDatabaseRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation);
        // } else if (request.method === 'GET' && url.pathname.startsWith('/export/json/')) {
        //     const tableName = url.pathname.split('/').pop();
        //     if (!tableName) {
        //         return createResponse(undefined, 'Table name is required', 400);
        //     }
        //     return exportTableToJsonRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName);
        // } else if (request.method === 'GET' && url.pathname.startsWith('/export/csv/')) {
        //     const tableName = url.pathname.split('/').pop();
        //     if (!tableName) {
        //         return createResponse(undefined, 'Table name is required', 400);
        //     }
        //     return exportTableToCsvRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName);
        // } else if (request.method === 'POST' && url.pathname === '/import/dump') {
        //     return importDumpRoute(request, this.sql, this.operationQueue, this.ctx, this.processingOperation);
        // } else if (request.method === 'POST' && url.pathname.startsWith('/import/json/')) {
        //     const tableName = url.pathname.split('/').pop();
        //     if (!tableName) {
        //         return createResponse(undefined, 'Table name is required', 400);
        //     }
        //     return importTableFromJsonRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName, request);
        // } else if (request.method === 'POST' && url.pathname.startsWith('/import/csv/')) {
        //     const tableName = url.pathname.split('/').pop();
        //     if (!tableName) {
        //         return createResponse(undefined, 'Table name is required', 400);
        //     }
        //     return importTableFromCsvRoute(this.sql, this.operationQueue, this.ctx, this.processingOperation, tableName, request);
        // } else if (url.pathname.startsWith('/api')) {
        //     return await handleApiRequest(request);
        // }

        return createResponse(undefined, 'Unknown operation', 400);
    }

    async queryRoute(request: Request, isRaw: boolean): Promise<Response> {
        // TODO:
        // Is it for the `internal` or `external` source?

        if (!this.dataSource) {
            return createResponse(undefined, 'Data source not found.', 400);
        }

        try {
            const contentType = request.headers.get('Content-Type') || '';
            if (!contentType.includes('application/json')) {
                return createResponse(undefined, 'Content-Type must be application/json.', 400);
            }
    
            const { sql, params, transaction } = await request.json() as QueryRequest & QueryTransactionRequest;

            // const response = await executeQuery(sql, params, isRaw, this.dataSource);
            // return createResponse(response, undefined, 200);
    




            if (Array.isArray(transaction) && transaction.length) {
                const queries = transaction.map((queryObj: any) => {
                    const { sql, params } = queryObj;

                    if (typeof sql !== 'string' || !sql.trim()) {
                        throw new Error('Invalid or empty "sql" field in transaction.');
                    } else if (params !== undefined && !Array.isArray(params)) {
                        throw new Error('Invalid "params" field in transaction.');
                    }

                    return { sql, params };
                });

                // try {
                //     const response = await enqueueOperation(
                //         queries,
                //         true,
                //         isRaw,
                //         this.operationQueue,
                //         () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
                //     );

                //     return createResponseFromOperationResponse(response);
                // } catch (error: any) {
                //     return createResponse(undefined, error.error || 'An unexpected error occurred.', error.status || 500);
                // }
            } else if (typeof sql !== 'string' || !sql.trim()) {
                return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
            } else if (params !== undefined && !Array.isArray(params)) {
                return createResponse(undefined, 'Invalid "params" field.', 400);
            }

            const response = await executeQuery(sql, params, isRaw, this.dataSource);
            return createResponse(response, undefined, 200);

            // try {
            //     const queries = [{ sql, params }];
            //     const response = await enqueueOperation(
            //         queries,
            //         false,
            //         isRaw,
            //         this.operationQueue,
            //         () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
            //     );
                
            //     return createResponseFromOperationResponse(response);
            // } catch (error: any) {
            //     return createResponse(undefined, error.error || 'An unexpected error occurred.', error.status || 500);
            // }
        } catch (error: any) {
            console.error('Query Route Error:', error);
            return createResponse(undefined, error || 'An unexpected error occurred.', 500);
        }
    }

    // clientConnected() {
    //     const webSocketPair = new WebSocketPair();
    //     const [client, server] = Object.values(webSocketPair);
    //     const wsSessionId = crypto.randomUUID();

    //     this.ctx.acceptWebSocket(server, [wsSessionId]);
    //     this.connections.set(wsSessionId, client);

    //     return new Response(null, { status: 101, webSocket: client });
    // }

    // async webSocketMessage(ws: WebSocket, message: any) {
    //     const { sql, params, action } = JSON.parse(message);
    
    //     if (action === 'query') {
    //         const queries = [{ sql, params }];
    //         const response = await enqueueOperation(
    //             queries,
    //             false,
    //             false,
    //             this.operationQueue,
    //             () => processNextOperation(this.sql, this.operationQueue, this.ctx, this.processingOperation)
    //         );

    //         ws.send(JSON.stringify(response.result));
    //     }
    // }

    // async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    //     // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
    //     ws.close(code, "StarbaseDB is closing WebSocket connection");

    //     // Remove the WebSocket connection from the map
    //     const tags = this.ctx.getTags(ws);
    //     if (tags.length) {
    //         const wsSessionId = tags[0];
    //         this.connections.delete(wsSessionId);
    //     }
    // }
}