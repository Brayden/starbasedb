import { WorkerEntrypoint } from "cloudflare:workers";

const parser = new (require('node-sql-parser').Parser)();

// Hard-coding a migrations table usage
// const RLS_CONDITIONS = [{
//     condition: {
//         type: 'binary_expr',
//         operator: '=',
//         left: { type: 'column_ref', table: 'migrations', column: 'name' },
//         right: { type: 'string', value: '20220505124737-addUuid.js' },
//     }
// }]

// Hard-coding a session table usage
const RLS_CONDITIONS = [{
    condition: {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', table: 'session', column: 'user_id' },
        right: { type: 'string', value: '428e46b4-60ef-4e18-a8bb-72a260ae2826' },
    }
}]

export default class RLSEntrypoint extends WorkerEntrypoint {
    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, { status: 404 }); }
    
    async applyRLS(sql: string, dialect?: string): Promise<string | Error> {
        if (!dialect) dialect = 'sqlite'
        if (dialect.toLowerCase() === 'postgres') dialect = 'postgresql'

        if (!sql) {
            return Error('No SQL query found in RLS plugin.')
        }

        // Add check for PRAGMA statements
        if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
            return sql; // Return the original SQL without modification
        }

        const applyRLSToAst = (ast: any) => {
            if (!ast) return;

            // Handle WITH (CTE) queries
            if (ast.with) {
                ast.with.ctes?.forEach((cte: any) => {
                    applyRLSToAst(cte.stmt);
                });
            }

            // Handle UNION, INTERSECT, etc.
            if (ast.type === 'union' || ast.type === 'intersect' || ast.type === 'except') {
                applyRLSToAst(ast.left);
                applyRLSToAst(ast.right);
                return;
            }

            // Handle INSERT/UPDATE/Delete with subqueries
            if (ast.type === 'insert' && ast.from) {
                applyRLSToAst(ast.from);
            }

            if (ast.type === 'update' && ast.where) {
                traverseWhere(ast.where);
            }

            if (ast.type === 'delete' && ast.where) {
                traverseWhere(ast.where);
            }

            // Skip non-SELECT statements after handling their subqueries
            if (ast.type !== 'select') {
                return;
            }

            // Apply RLS to main query
            RLS_CONDITIONS.forEach(({ condition }) => {
                const isTargetTable = ast.from?.some((fromTable: any) => {
                    // Handle schema-qualified table names
                    const tableName = fromTable.table;
                    const schemaTable = tableName.includes('.') ? tableName.split('.')[1] : tableName;
                    return schemaTable === condition.left.table || fromTable.as === condition.left.table;
                });

                if (isTargetTable) {
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
                }
            });

            // Handle JOIN subqueries
            ast.from?.forEach((fromItem: any) => {
                // Handle subquery in FROM
                if (fromItem.expr && fromItem.expr.type === 'select') {
                    applyRLSToAst(fromItem.expr);
                }
                
                // Handle JOIN subqueries
                if (fromItem.join) {
                    fromItem.join?.forEach((joinItem: any) => {
                        if (joinItem.expr && joinItem.expr.type === 'select') {
                            applyRLSToAst(joinItem.expr);
                        }
                    });
                }
            });

            // Handle subqueries in WHERE clause
            if (ast.where) {
                traverseWhere(ast.where);
            }

            // Handle subqueries in SELECT clause
            ast.columns?.forEach((column: any) => {
                if (column.expr && column.expr.type === 'select') {
                    applyRLSToAst(column.expr);
                }
            });
        };

        const traverseWhere = (node: any) => {
            if (!node) return;
            if (node.type === 'select') {
                applyRLSToAst(node);
            }
            if (node.left) traverseWhere(node.left);
            if (node.right) traverseWhere(node.right);
        };

        let ast;
        try {
            // Parse the SQL query with the specified dialect and options
            // ast = parser.astify(sql, { 
            //     database: dialect, 
            //     supportMultiSchema: true,  // Enable support for schema-qualified table names
            //     multistatement: true       // Enable parsing of statements ending with semicolons
            // });
            ast = parser.astify(sql);
        } catch (error) {
            console.error('Error parsing SQL:', error);
            return error as Error;
        }

        // Handle both single AST and array of ASTs
        if (Array.isArray(ast)) {
            ast.forEach(singleAst => applyRLSToAst(singleAst));
        } else {
            applyRLSToAst(ast);
        }

        // Generate the modified SQL
        let modifiedSql;
        try {
            const sqlifyOptions = {
                database: dialect,
                quote: ''  // This prevents adding backticks/quotes around identifiers
            };
            
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
}