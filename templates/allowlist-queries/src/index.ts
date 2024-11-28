import { WorkerEntrypoint } from "cloudflare:workers";

const DURABLE_OBJECT_ID = 'sql-durable-object';
const parser = new (require('node-sql-parser').Parser)();

type QueryRequest = {
    sql: string;
    params?: any[];
};

interface Env {
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
}

function normalizeSQL(sql: string) {
    // Remove trailing semicolon. This allows a user to send a SQL statement that has
    // a semicolon where the allow list might not include it but both statements can
    // equate to being the same. AST seems to have an issue with matching the difference
    // when included in one query vs another.
    return sql.trim().replace(/;\s*$/, '');
}

export default class AllowlistQueriesEntrypoint extends WorkerEntrypoint<Env> {
    private stub: any;
    private allowList: string[] | null = null;

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    private async loadAllowList(): Promise<string[]> {
        let id: DurableObjectId = this.env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		this.stub = this.env.DATABASE_DURABLE_OBJECT.get(id);

        try {
            const { result } = await this.stub.executeExternalQuery(
                'SELECT sql_statement FROM tmp_allowlist_queries',
                []
            );
            return result.map((row: any) => row.sql_statement);
        } catch (error) {
            console.error('Error loading allow list:', error);
            return [];
        }
    }

    async isQueryAllowed(body: Record<string, any>): Promise<boolean> {
        // Load allow list if not already loaded
        if (!this.allowList) {
            this.allowList = await this.loadAllowList();
        }
        
        const normalizedAllowList = this.allowList.map(query => parser.astify(normalizeSQL(query)));
        
        try {
            const { sql, transaction } = body;

            let queries: QueryRequest[] = [];

            if (transaction) {
                queries = transaction
            } else if (sql) {
                queries = [{
                    sql
                }]
            }
        
            if (!sql && !transaction) {
                return false;
            }
            
            let isAllowed = true;

            // Loop through each query object and test if it meets the requirements.
            queries.forEach((query: QueryRequest) => {
                const normalizedQuery = parser.astify(normalizeSQL(query.sql));
                const isCurrentAllowed = normalizedAllowList.some(
                    allowedQuery => JSON.stringify(allowedQuery) === JSON.stringify(normalizedQuery)
                );

                // If any of the provided queries fail, they all fail.
                if (!query.sql || !isCurrentAllowed) {
                    isAllowed = false;
                    return;
                }
            });

            return isAllowed;
        } catch (error) {
            console.error('Error:', error);
            return false;
        }
    }
}
