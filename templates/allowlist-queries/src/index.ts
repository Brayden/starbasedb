import { WorkerEntrypoint } from "cloudflare:workers";

const DURABLE_OBJECT_ID = 'sql-durable-object';
const parser = new (require('node-sql-parser').Parser)();

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
    private allowlist: string[] | null = null;
    private normalizedAllowlist: any[] | null = null;

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    private async loadAllowlist(): Promise<string[]> {
        let id: DurableObjectId = this.env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		this.stub = this.env.DATABASE_DURABLE_OBJECT.get(id);

        try {
            const { result } = await this.stub.executeExternalQuery(
                'SELECT sql_statement FROM tmp_allowlist_queries',
                []
            );
            return result.map((row: any) => row.sql_statement);
        } catch (error) {
            console.error('Error loading allowlist:', error);
            return [];
        }
    }

    async isQueryAllowed(sql: string): Promise<boolean | Error> {
        if (!this.allowlist) {
            this.allowlist = await this.loadAllowlist();
            this.normalizedAllowlist = this.allowlist.map(query => parser.astify(normalizeSQL(query)));
        }
        
        try {
            if (!sql) {
                return Error('No SQL provided for allowlist check')
            }

            const normalizedQuery = parser.astify(normalizeSQL(sql));
            
            // Compare ASTs while ignoring specific values
            const isCurrentAllowed = this.normalizedAllowlist?.some(allowedQuery => {
                // Create deep copies to avoid modifying original ASTs
                const allowedAst = JSON.parse(JSON.stringify(allowedQuery));
                const queryAst = JSON.parse(JSON.stringify(normalizedQuery));
                
                // Remove or normalize value fields from both ASTs
                const normalizeAst = (ast: any) => {
                    if (Array.isArray(ast)) {
                        ast.forEach(normalizeAst);
                    } else if (ast && typeof ast === 'object') {
                        // Remove or normalize fields that contain specific values
                        if ('value' in ast) {
                            ast.value = '?';
                        }
                        Object.values(ast).forEach(normalizeAst);
                    }
                    return ast;
                };

                normalizeAst(allowedAst);
                normalizeAst(queryAst);
                
                return JSON.stringify(allowedAst) === JSON.stringify(queryAst);
            });

            if (!isCurrentAllowed) {
                return Error('Query not allowed')
            }

            return true;
        } catch (error: any) {
            console.error('Error:', error);
            return Error(error?.message ?? 'Error');
        }
    }
}
