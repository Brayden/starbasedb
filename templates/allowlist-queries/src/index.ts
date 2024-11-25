import { WorkerEntrypoint } from "cloudflare:workers";

const DURABLE_OBJECT_ID = 'sql-durable-object';
const parser = new (require('node-sql-parser').Parser)();

const ALLOW_LIST = [
    "SELECT * FROM users WHERE user_id = ?",
    "INSERT INTO orders (user_id, amount) VALUES (?, ?)",
];
const normalizedAllowList = ALLOW_LIST.map(query => parser.astify(normalizeSQL(query)));

function normalizeSQL(sql: string) {
    // Remove trailing semicolon. This allows a user to send a SQL statement that has
    // a semicolon where the allow list might not include it but both statements can
    // equate to being the same. AST seems to have an issue with matching the difference
    // when included in one query vs another.
    return sql.trim().replace(/;\s*$/, '');
}

type QueryRequest = {
    sql: string;
    params?: any[];
};

interface Env {
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
}

export default class AllowlistQueriesEntrypoint extends WorkerEntrypoint<Env> {
    private stub: any;

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    async isQueryAllowed(body: Record<string, any>): Promise<boolean> {        
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
