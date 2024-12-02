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

    async isQueryAllowed(sql: string): Promise<boolean | Error> {
        // Load allowlist if not already loaded
        if (!this.allowList) {
            this.allowList = await this.loadAllowList();
        }
        
        const normalizedAllowList = this.allowList.map(query => parser.astify(normalizeSQL(query)));
        
        try {
            if (!sql) {
                return Error('No SQL provided for allowlist check')
                // return false;
            }
            
            let isAllowed = true;

            const normalizedQuery = parser.astify(normalizeSQL(sql));
            const isCurrentAllowed = normalizedAllowList.some(
                allowedQuery => JSON.stringify(allowedQuery) === JSON.stringify(normalizedQuery)
            );

            if (!sql || !isCurrentAllowed) {
                return Error('Query not allowed')
                // isAllowed = false;
            }

            return isAllowed;
        } catch (error) {
            console.error('Error:', error);
            return false;
        }
    }
}
