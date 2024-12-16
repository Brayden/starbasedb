import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { validator } from "hono/validator";

import { DataSource, Source } from "./types";
import { LiteREST } from "./literest";
// import { executeQuery, executeTransaction } from "./operation";
import { createResponse, QueryRequest, QueryTransactionRequest } from "./utils";
// import { handleApiRequest } from "./api";
// import { dumpDatabaseRoute } from "./export/dump";
// import { exportTableToJsonRoute } from "./export/json";
// import { exportTableToCsvRoute } from "./export/csv";
// import { importDumpRoute } from "./import/dump";
// import { importTableFromJsonRoute } from "./import/json";
// import { importTableFromCsvRoute } from "./import/csv";

// export interface HandlerConfig {
//   adminAuthorizationToken: string;
//   outerbaseApiKey?: string;
//   enableAllowlist?: boolean;
//   enableRls?: boolean;

//   externalDbType?: string;

//   externalDbHost?: string;
//   externalDbPort?: number;
//   externalDbUser?: string;
//   externalDbPassword?: string;
//   externalDbName?: string;
//   externalDbDefaultSchema?: string;

//   externalDbMongodbUri?: string;

//   externalDbTursoUri?: string;
//   externalDbTursoToken?: string;

//   externalDbCloudflareApiKey?: string;
//   externalDbCloudflareAccountId?: string;
//   externalDbCloudflareDatabaseId?: string;

//   externalDbStarbaseUri?: string;
//   externalDbStarbaseToken?: string;
// }

export interface StarbaseDBConfiguration {
  role: "admin" | "user";
  features?: {
    allowlist?: boolean;
    rls?: boolean;
    studio?: boolean;
    rest?: boolean;
    websocket?: boolean;
    export?: boolean;
    import?: boolean;
  };
}

export class StarbaseDB {
  private dataSource: DataSource;
  private config: StarbaseDBConfiguration;
  private liteREST: LiteREST;

  constructor(options: {
    dataSource: DataSource;
    config: StarbaseDBConfiguration;
  }) {
    this.dataSource = options.dataSource;
    this.config = options.config;
    this.liteREST = new LiteREST(this.dataSource, this.config);
  }

  // private get isInternalSource() {
  //   return createMiddleware(async (_, next) => {
  //     if (this.dataSource.source !== Source.internal) {
  //       return createResponse(
  //         undefined,
  //         "Function is only available for internal data source.",
  //         400
  //       );
  //     }

  //     return next();
  //   });
  // }

  // private get hasTableName() {
  //   return validator("param", (params) => {
  //     const tableName = params["tableName"];

  //     if (!tableName) {
  //       return createResponse(undefined, "Table name is required", 400);
  //     }

  //     return { tableName };
  //   });
  // }

  private getFeature(
    key: keyof NonNullable<StarbaseDBConfiguration["features"]>,
    defaultValue = true
  ): boolean {
    return this.config.features?.[key] ?? !!defaultValue;
  }

  public async handle(request: Request): Promise<Response> {
    const app = new Hono();

    // General 404 not found handler
    app.notFound(() => {
      return createResponse(undefined, "Not found", 404);
    });

    // Thrown error handler
    app.onError((error) => {
      return createResponse(
        undefined,
        error?.message || "An unexpected error occurred.",
        500
      );
    });

    // Allow CORS for all routes.
    app.use(
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: [
          "Authorization",
          "Content-Type",
          "X-Starbase-Source",
          "X-Data-Source",
        ],
        maxAge: 86400,
      })
    );

    if (this.getFeature("websocket")) {
      app.all("/socket", async () => this.clientConnected());
    }

    app.post("/query/raw", async (c) => this.queryRoute(c.req.raw, true));
    app.post("/query", async (c) => this.queryRoute(c.req.raw, false));

    if (this.getFeature("rest")) {
      app.all("/rest/*", async (c) => {
        return this.liteREST.handleRequest(c.req.raw);
      });
    }

    if (this.getFeature("export")) {
      app.get("/export/dump", this.isInternalSource, async () => {
        return dumpDatabaseRoute(this.dataSource);
      });

      app.get(
        "/export/json/:tableName",
        this.isInternalSource,
        this.hasTableName,
        async (c) => {
          const tableName = c.req.valid("param").tableName;
          return exportTableToJsonRoute(tableName, this.dataSource);
        }
      );

      app.get(
        "/export/csv/:tableName",
        this.isInternalSource,
        this.hasTableName,
        async (c) => {
          const tableName = c.req.valid("param").tableName;
          return exportTableToCsvRoute(tableName, this.dataSource);
        }
      );
    }

    if (this.getFeature("import")) {
      app.post("/import/dump", this.isInternalSource, async (c) => {
        return importDumpRoute(c.req.raw, this.dataSource);
      });

      app.post(
        "/import/json/:tableName",
        this.isInternalSource,
        this.hasTableName,
        async (c) => {
          const tableName = c.req.valid("param").tableName;
          return importTableFromJsonRoute(tableName, request, this.dataSource);
        }
      );

      app.post(
        "/import/csv/:tableName",
        this.isInternalSource,
        this.hasTableName,
        async (c) => {
          const tableName = c.req.valid("param").tableName;
          return importTableFromCsvRoute(tableName, request, this.dataSource);
        }
      );
    }

    return createResponse(undefined, "Unknown operation", 400);
  }

  // async queryRoute(request: Request, isRaw: boolean): Promise<Response> {
  //   try {
  //     const contentType = request.headers.get("Content-Type") || "";
  //     if (!contentType.includes("application/json")) {
  //       return createResponse(
  //         undefined,
  //         "Content-Type must be application/json.",
  //         400
  //       );
  //     }

  //     const { sql, params, transaction } =
  //       (await request.json()) as QueryRequest & QueryTransactionRequest;

  //     if (Array.isArray(transaction) && transaction.length) {
  //       const queries = transaction.map((queryObj: any) => {
  //         const { sql, params } = queryObj;

  //         if (typeof sql !== "string" || !sql.trim()) {
  //           throw new Error('Invalid or empty "sql" field in transaction.');
  //         } else if (
  //           params !== undefined &&
  //           !Array.isArray(params) &&
  //           typeof params !== "object"
  //         ) {
  //           throw new Error(
  //             'Invalid "params" field in transaction. Must be an array or object.'
  //           );
  //         }

  //         return { sql, params };
  //       });

  //       const response = await executeTransaction(
  //         queries,
  //         isRaw,
  //         this.dataSource,
  //         this.config
  //       );
  //       return createResponse(response, undefined, 200);
  //     } else if (typeof sql !== "string" || !sql.trim()) {
  //       return createResponse(undefined, 'Invalid or empty "sql" field.', 400);
  //     } else if (
  //       params !== undefined &&
  //       !Array.isArray(params) &&
  //       typeof params !== "object"
  //     ) {
  //       return createResponse(
  //         undefined,
  //         'Invalid "params" field. Must be an array or object.',
  //         400
  //       );
  //     }

  //     const response = await executeQuery(
  //       sql,
  //       params,
  //       isRaw,
  //       this.dataSource,
  //       this.config
  //     );
  //     return createResponse(response, undefined, 200);
  //   } catch (error: any) {
  //     console.error("Query Route Error:", error);
  //     return createResponse(
  //       undefined,
  //       error?.message || "An unexpected error occurred.",
  //       500
  //     );
  //   }
  // }

  clientConnected() {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    server.addEventListener("message", (event) => {
      const { sql, params, action } = JSON.parse(event.data as string);

      if (action === "query") {
        const executeQueryWrapper = async () => {
          const response = await executeQuery(
            sql,
            params,
            false,
            this.dataSource
          );
          server.send(JSON.stringify(response));
        };
        executeQueryWrapper();
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}
