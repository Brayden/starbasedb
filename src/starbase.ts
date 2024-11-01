import { DurableObject } from "cloudflare:workers";
import {
  createResponse,
  createResponseFromOperationResponse,
  QueryRequest,
  QueryTransactionRequest,
  toBooleanValue,
} from "./utils";
import {
  enqueueOperation,
  OperationQueueItem,
  processNextOperation,
} from "./operation";
import { LiteREST } from "./literest";
import { dumpDatabaseRoute } from "./export/dump";
import { exportTableToJsonRoute } from "./export/json";
import { exportTableToCsvRoute } from "./export/csv";
import { importDumpRoute } from "./import/dump";
import { importTableFromJsonRoute } from "./import/json";
import { importTableFromCsvRoute } from "./import/csv";

export { default as handleStudioRequest } from "./studio";

export type StarbaseDurableObjectConfiguration = {
  exportEnabled?: boolean;
  importEnabled?: boolean;
  websocketEnabled?: boolean;
  statusEnabled?: boolean;
  restEnabled?: boolean;
  onRequest?: (request: Request, ctx: DurableObjectState) => (Promise<Response | void> | Response | void);
};

export class StarbaseDurableObject extends DurableObject {
  // Durable storage for the SQL database
  public sql: SqlStorage;

  // Queue of operations to be processed, with each operation containing a list of queries to be executed
  private operationQueue: Array<OperationQueueItem> = [];

  // Flag to indicate if an operation is currently being processed
  private processingOperation: { value: boolean } = { value: false };

  // Map of WebSocket connections to their corresponding session IDs
  private connections = new Map<string, WebSocket>();

  // Instantiate LiteREST
  private liteREST: LiteREST;

  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.toml
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Initialize LiteREST for handling /lite routes
    this.liteREST = new LiteREST(
      ctx,
      this.operationQueue,
      this.processingOperation,
      this.sql
    );
  }

  /**
   * Execute a raw SQL query on the database, typically used for external requests
   * from other service bindings (e.g. auth). This serves as an exposed function for
   * other service bindings to query the database without having to have knowledge of
   * the current operation queue or processing state.
   *
   * @param sql - The SQL query to execute.
   * @param params - Optional parameters for the SQL query.
   * @returns A response containing the query result or an error message.
   */
  async executeExternalQuery(
    sql: string,
    params: any[] | undefined
  ): Promise<any> {
    try {
      const queries = [{ sql, params }];
      const response = await enqueueOperation(
        queries,
        false,
        false,
        this.operationQueue,
        () =>
          processNextOperation(
            this.sql,
            this.operationQueue,
            this.ctx,
            this.processingOperation
          )
      );

      return response;
    } catch (error: any) {
      console.error("Execute External Query Error:", error);
      return null;
    }
  }

  async queryRoute(request: Request, isRaw: boolean): Promise<Response> {
    try {
      const contentType = request.headers.get("Content-Type") || "";
      if (!contentType.includes("application/json")) {
        return createResponse(
          undefined,
          "Content-Type must be application/json.",
          400
        );
      }

      const { sql, params, transaction } =
        (await request.json()) as QueryRequest & QueryTransactionRequest;

      if (Array.isArray(transaction) && transaction.length) {
        const queries = transaction.map((queryObj: any) => {
          const { sql, params } = queryObj;

          if (typeof sql !== "string" || !sql.trim()) {
            throw new Error('Invalid or empty "sql" field in transaction.');
          } else if (params !== undefined && !Array.isArray(params)) {
            throw new Error('Invalid "params" field in transaction.');
          }

          return { sql, params };
        });

        try {
          const response = await enqueueOperation(
            queries,
            true,
            isRaw,
            this.operationQueue,
            () =>
              processNextOperation(
                this.sql,
                this.operationQueue,
                this.ctx,
                this.processingOperation
              )
          );

          return createResponseFromOperationResponse(response);
        } catch (error: any) {
          return createResponse(
            undefined,
            error.error || "An unexpected error occurred.",
            error.status || 500
          );
        }
      } else if (typeof sql !== "string" || !sql.trim()) {
        return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
      } else if (params !== undefined && !Array.isArray(params)) {
        return createResponse(undefined, 'Invalid "params" field.', 400);
      }

      try {
        const queries = [{ sql, params }];
        const response = await enqueueOperation(
          queries,
          false,
          isRaw,
          this.operationQueue,
          () =>
            processNextOperation(
              this.sql,
              this.operationQueue,
              this.ctx,
              this.processingOperation
            )
        );

        return createResponseFromOperationResponse(response);
      } catch (error: any) {
        return createResponse(
          undefined,
          error.error || "An unexpected error occurred.",
          error.status || 500
        );
      }
    } catch (error: any) {
      console.error("Query Route Error:", error);
      return createResponse(
        undefined,
        error || "An unexpected error occurred.",
        500
      );
    }
  }

  async statusRoute(_: Request): Promise<Response> {
    return createResponse(
      {
        status: "reachable",
        timestamp: Date.now(),
        usedDisk: this.sql.databaseSize,
      },
      undefined,
      200
    );
  }

  async serve(request: Request, config?: StarbaseDurableObjectConfiguration): Promise<Response> {
    const url = new URL(request.url);

    const exportEnabled = toBooleanValue(config?.exportEnabled, true);
    const importEnabled = toBooleanValue(config?.importEnabled, true);
    const websocketEnabled = toBooleanValue(config?.websocketEnabled, true);
    const statusEnabled = toBooleanValue(config?.statusEnabled, true);
    const restEnabled = toBooleanValue(config?.restEnabled, true);

    if (request.method === "POST" && url.pathname === "/query/raw") {
      return this.queryRoute(request, true);
    } else if (request.method === "POST" && url.pathname === "/query") {
      return this.queryRoute(request, false);
    } else if (websocketEnabled && url.pathname === "/socket") {
      return this.clientConnected();
    } else if (
      statusEnabled &&
      request.method === "GET" &&
      url.pathname === "/status"
    ) {
      return this.statusRoute(request);
    } else if (restEnabled && url.pathname.startsWith("/rest")) {
      return await this.liteREST.handleRequest(request);
    } else if (
      exportEnabled &&
      request.method === "GET" &&
      url.pathname === "/export/dump"
    ) {
      return dumpDatabaseRoute(
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation
      );
    } else if (
      exportEnabled &&
      request.method === "GET" &&
      url.pathname.startsWith("/export/json/")
    ) {
      const tableName = url.pathname.split("/").pop();
      if (!tableName) {
        return createResponse(undefined, "Table name is required", 400);
      }
      return exportTableToJsonRoute(
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation,
        tableName
      );
    } else if (
      exportEnabled &&
      request.method === "GET" &&
      url.pathname.startsWith("/export/csv/")
    ) {
      const tableName = url.pathname.split("/").pop();
      if (!tableName) {
        return createResponse(undefined, "Table name is required", 400);
      }
      return exportTableToCsvRoute(
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation,
        tableName
      );
    } else if (
      importEnabled &&
      request.method === "POST" &&
      url.pathname === "/import/dump"
    ) {
      return importDumpRoute(
        request,
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation
      );
    } else if (
      importEnabled &&
      request.method === "POST" &&
      url.pathname.startsWith("/import/json/")
    ) {
      const tableName = url.pathname.split("/").pop();
      if (!tableName) {
        return createResponse(undefined, "Table name is required", 400);
      }
      return importTableFromJsonRoute(
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation,
        tableName,
        request
      );
    } else if (
      importEnabled &&
      request.method === "POST" &&
      url.pathname.startsWith("/import/csv/")
    ) {
      const tableName = url.pathname.split("/").pop();
      if (!tableName) {
        return createResponse(undefined, "Table name is required", 400);
      }
      return importTableFromCsvRoute(
        this.sql,
        this.operationQueue,
        this.ctx,
        this.processingOperation,
        tableName,
        request
      );
    } else if (config?.onRequest) {
      const response = await config.onRequest(request, this.ctx);

      if (response) {
        return response;
      }
    }


    return createResponse(undefined, "Unknown operation", 400);
  }

  async fetch(request: Request): Promise<Response> {
    return this.serve(request);
  }

  clientConnected() {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    const wsSessionId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server, [wsSessionId]);
    this.connections.set(wsSessionId, client);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: any) {
    const { sql, params, action } = JSON.parse(message);

    if (action === "query") {
      const queries = [{ sql, params }];
      const response = await enqueueOperation(
        queries,
        false,
        false,
        this.operationQueue,
        () =>
          processNextOperation(
            this.sql,
            this.operationQueue,
            this.ctx,
            this.processingOperation
          )
      );

      ws.send(JSON.stringify(response.result));
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    // If the client closes the connection, the runtime will invoke the webSocketClose() handler.
    ws.close(code, "StarbaseDB is closing WebSocket connection");

    // Remove the WebSocket connection from the map
    const tags = this.ctx.getTags(ws);
    if (tags.length) {
      const wsSessionId = tags[0];
      this.connections.delete(wsSessionId);
    }
  }
}
