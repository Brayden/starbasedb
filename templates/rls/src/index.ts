import { WorkerEntrypoint } from "cloudflare:workers";

const DURABLE_OBJECT_ID = 'sql-durable-object';
const parser = new (require('node-sql-parser').Parser)();

interface Env {
    DATABASE_DURABLE_OBJECT: DurableObjectNamespace;
}

type Policy = {
    action: string;
    condition: {
        type: string
        operator: string;
        left: {
            type: string;
            table: string;
            column: string;
        };
        right: {
            type: string;
            value: string;
        }
    }
}

// Rules on how RLS policies should work
// 1. If a table has _any_ rules applied to it, then each action needs to be explicitly defined or it should be automatically denied.
    // For example, if I say "SELECT" on table "todos" has an RLS policy but no entry for "INSERT" then insert statements should fail.
    // This is the equivalent of turning "on" RLS for a particular table.
// 2. For any actions of type "SELECT" we want to inject an additional WHERE clause wrapped in `(...)` which prevents overriding like `1=1`

// ----------

// Things to consider:
// 1. Do we need to always check `schema`.`table` instead of just `table` or whatever is entered in our policy table?
// 2. Perhaps we should automatically throw an error if there is an error querying (or zero results return) from the policy table?
    // -> I say this because if an error occurs then it would entirely circumvent rules and over-expose data. 
    // -> If they really don't want any rules to exist, remove this power-up

export default class RLSEntrypoint extends WorkerEntrypoint<Env> {
    private stub: any;
    private policies: Policy[] = [];

    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, { status: 404 }); }

    private async loadPolicies(context?: Record<string, any>): Promise<Policy[]> {
        let id: DurableObjectId = this.env.DATABASE_DURABLE_OBJECT.idFromName(DURABLE_OBJECT_ID);
		this.stub = this.env.DATABASE_DURABLE_OBJECT.get(id);

        try {
            const { result } = await this.stub.executeExternalQuery(
                'SELECT "actions", "schema", "table", "column", "value", "value_type", "operator" FROM tmp_rls_policies',
                []
            );

            return result.map((row: any) => {
                let value = row.value;
                const valueType = row.value_type?.toLowerCase();

                // Handle scenarios when the replacement value is marked as context function value
                // A helper exists for the special case where a user might define `context.id()`
                // and we interpret that manually to match to the JWT `sub` key which typically
                // contains the userId value. You can pass any other key from the JWT by doing
                // `context.keyName()` and we will replace the value from the JWT in the SQL.
                if (value === 'context.id()') {
                    value = context?.sub;
                } else if (/^context\.\w+\(\)$/.test(value)) {
                    const key = value.match(/^context\.(\w+)\(\)$/)[1];
                    value = context?.[key];
                }

                // Currently we are supporting two `value_type` options for the time being. By
                // default values are assumed as `string` unless the type is expressed as another
                // in which we cast it to that type. We will need to handle scenarios where
                // the SQL statement itself will need the type casting.
                if (valueType === 'number') {
                    value = Number(value)

                    // For example, some databases may require casting like the commented out
                    // string here below.
                    // value = `${value}::INT`
                }

                // This policy will help construct clauses, such as a WHERE, for the criteria to be met.
                // For example the left side equals the qualifier table column and the right side equals
                // the value that column should be set to. So a basic example could be:
                // `WHERE (my_column = '1234')`
                return {
                    action: row.actions.toUpperCase(),
                    condition: {
                        type: 'binary_expr',
                        operator: row.operator,
                        left: { type: 'column_ref', table: row.schema ? `${row.schema}.${row.table}` : row.table, column: row.column },
                        right: { type: 'string', value: value },
                    }
                }
            });
        } catch (error) {
            console.error('Error loading RLS policies:', error);
            return [];
        }
    }

    async applyRLS(sql: string, context?: Record<string, any>, dialect?: string): Promise<string | Error> {
        if (!sql) {
            return Error('No SQL query found in RLS plugin.')
        }

        this.policies = await this.loadPolicies(context)

        if (!dialect) dialect = 'sqlite'
        if (dialect.toLowerCase() === 'postgres') dialect = 'postgresql'
        
        let ast;
        let modifiedSql;
        const sqlifyOptions = {
            database: dialect,
            quote: ''  // This prevents adding backticks/quotes around identifiers
        };

        // We are originally provided a SQL statement to evaluate. The first task we must
        // complete is converting it from SQL to an AST object we can breakdown and 
        // understand the structure. By breaking down the structure this is where we can
        // begin applying our RLS policies by injecting items into the abstract syntax
        // tree which will later be converted back to an executable SQL statement.
        try {
            ast = parser.astify(sql);

            if (Array.isArray(ast)) {
                ast.forEach(singleAst => this.applyRLSToAst(singleAst));
            } else {
                this.applyRLSToAst(ast);
            }
        } catch (error) {
            console.error('Error parsing SQL:', error);
            return error as Error;
        }
        
        // After the query was converted into an AST and had any RLS policy rules
        // injected into the abstract syntax tree dynamically, now we are ready to
        // convert the AST object back into a SQL statement that the database can
        // execute.
        try {
            if (Array.isArray(ast)) {
                modifiedSql = ast.map(singleAst => parser.sqlify(singleAst, sqlifyOptions)).join('; ');
            } else {
                modifiedSql = parser.sqlify(ast, sqlifyOptions);
            }
        } catch (error) {
            console.error('Error generating SQL from AST:', error);
            return error as Error;
        }

        return modifiedSql;
    }

    private applyRLSToAst(ast: any): void {
        if (!ast) return;

        // Handle WITH (CTE) queries
        if (ast.with) {
            ast.with.ctes?.forEach((cte: any) => {
                this.applyRLSToAst(cte.stmt);
            });
        }

        // Handle UNION, INTERSECT, etc.
        if (ast.type === 'union' || ast.type === 'intersect' || ast.type === 'except') {
            this.applyRLSToAst(ast.left);
            this.applyRLSToAst(ast.right);
            return;
        }

        // Handle INSERT/UPDATE/DELETE with subqueries
        if (ast.type === 'insert' && ast.from) {
            this.applyRLSToAst(ast.from);
        }

        // Traverse any WHERE clause where it exists to make sure we apply
        // any rules to embedded subqueries within our SQL
        if (ast.type === 'update' && ast.where) {
            this.traverseWhere(ast.where);
        }

        if (ast.type === 'delete' && ast.where) {
            this.traverseWhere(ast.where);
        }

        const tablesWithRules: Record<string, string[]> = {}
        this.policies.forEach(policy => {
            const table: string = policy.condition.left.table;
            if (!tablesWithRules[table]) {
                tablesWithRules[table] = []
            }

            tablesWithRules[table].push(policy.action)
        });

        // Get the current statement type
        const statementType = ast.type.toUpperCase();

        // For SELECT/UPDATE/DELETE/INSERT statements
        if (['SELECT', 'UPDATE', 'DELETE', 'INSERT'].includes(statementType)) {
            // Get tables based on statement type
            let tables: string[] = [];

            if (statementType === 'INSERT') {
                // For INSERT, check the target table
                const tableName = ast.table[0].table;
                tables = [tableName.includes('.') ? tableName.split('.')[1] : tableName];
            } else if (statementType === 'UPDATE') {
                // For UPDATE, check the target table(s)
                tables = ast.table.map((tableRef: any) => {
                    const tableName = tableRef.table;
                    return tableName.includes('.') ? tableName.split('.')[1] : tableName;
                });
            } else {
                // For SELECT/DELETE statements, check the from clause
                tables = ast.from?.map((fromTable: any) => {
                    const tableName = fromTable.table;
                    return tableName.includes('.') ? tableName.split('.')[1] : tableName;
                }) || [];
            }

            // Check if any table has RLS rules but no explicit rule for this action
            const hasAuthorizedAccess = tables.some(table => {
                const allowedActions = tablesWithRules[table];
                
                // First check if this table exists in our rules
                if (allowedActions) {
                    // If it has rules, verify this action is allowed
                    const isAllowed = allowedActions.includes(statementType);

                    if (!isAllowed) {
                        throw new Error(`Unauthorized access: No matching rules for ${statementType} on restricted table`);
                    }
                } else {
                    // If no rules apply for this table, then we should consider it authorized
                    return {}
                }
                
                // Check if this table exists in our policies at all
                return Object.keys(tablesWithRules).includes(table);
            });

            if (!hasAuthorizedAccess) {
                throw new Error(`Unauthorized access: No matching rules for ${statementType} on restricted table`);
            }

            // Apply matching rules for authorized tables
            this.policies
                .filter(policy => policy.action === statementType || policy.action === '*')
                .forEach(({ action, condition }) => {
                    const isTargetTable = tables.some(table => 
                        table === condition.left.table
                    );

                    if (isTargetTable && action !== 'INSERT') {
                        // Wrap the existing WHERE clause in parentheses if it exists
                        const existingWhere = ast.where ? {
                            type: 'expr_list',
                            value: [ast.where],
                            parentheses: true
                        } : null;

                        // Wrap the RLS condition in parentheses
                        const rlsCondition = {
                            type: 'expr_list',
                            value: [condition],
                            parentheses: true
                        };

                        if (existingWhere) {
                            ast.where = {
                                type: 'binary_expr',
                                operator: 'AND',
                                left: existingWhere,
                                right: rlsCondition
                            };
                        } else {
                            ast.where = rlsCondition;
                        }
                    } else if (action === 'INSERT') {
                        if (ast.values && ast.values.length > 0) {
                            const columnIndex = ast.columns.findIndex((col: any) => 
                                col.toLowerCase() === condition.left.column.toLowerCase()
                            );
                            
                            if (columnIndex !== -1) {
                                // Replace the value in all value lists
                                ast.values.forEach((valueList: any) => {
                                    // Handle case where the value is an expr_list
                                    if (valueList.type === 'expr_list' && Array.isArray(valueList.value)) {
                                        valueList.value[columnIndex] = {
                                            type: condition.right.type,
                                            value: condition.right.value
                                        };
                                    } else {
                                        // Direct value replacement
                                        valueList[columnIndex] = {
                                            type: condition.right.type,
                                            value: condition.right.value
                                        };
                                    }
                                });
                            }
                        }
                    }
                });
        }

        // Handle JOIN subqueries
        ast.from?.forEach((fromItem: any) => {
            if (fromItem.expr && fromItem.expr.type === 'select') {
                this.applyRLSToAst(fromItem.expr);
            }
            
            if (fromItem.join) {
                fromItem.join?.forEach((joinItem: any) => {
                    if (joinItem.expr && joinItem.expr.type === 'select') {
                        this.applyRLSToAst(joinItem.expr);
                    }
                });
            }
        });

        // Handle subqueries in WHERE clause
        if (ast.where) {
            this.traverseWhere(ast.where);
        }

        // Handle subqueries in SELECT clause
        ast.columns?.forEach((column: any) => {
            if (column.expr && column.expr.type === 'select') {
                this.applyRLSToAst(column.expr);
            }
        });
    }

    private traverseWhere(node: any): void {
        if (!node) return;
        if (node.type === 'select') {
            this.applyRLSToAst(node);
        }
        if (node.left) this.traverseWhere(node.left);
        if (node.right) this.traverseWhere(node.right);
    }
}