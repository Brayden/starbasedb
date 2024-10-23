import { Parser } from 'node-sql-parser';
import { createResponse } from './utils';

export type OperationQueueItem = {
    queries: { sql: string; params?: any[] }[];
    isTransaction: boolean;
    isRaw: boolean;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

export type RawQueryResponse = {
    columns: string[];
    rows: any[];
    meta: {
        rows_read: number;
        rows_written: number;
    }
}

export type QueryResponse = any[] | RawQueryResponse;

function maskDataWithMethod(data: any, method: 'asterisk' | 'hash' | 'random') {
    switch (method) {
        case 'asterisk':
            return '*******';
        case 'hash':
            return 'HASH METHOD';
        case 'random':
            return Math.random().toString(36).substring(2, 15);
    }
}

export function executeQuery(sql: string, params: any[] | undefined, isRaw: boolean, sqlInstance: any): QueryResponse {
    const parser = new Parser();
    const ast: any = parser.astify(sql);
    let columnsMap: Record<string, any>[] = [];

    //
    // This would be stored somewhere else, e.g. in the database
    let columnsToMask: Record<string, any>[] = [{
        schema: null,
        table: 'users',
        original: 'name',
        method: 'asterisk'
    }];
    // This would be stored somewhere else, e.g. in the database
    //

    // Handle both array and single object cases
    const statements = Array.isArray(ast) ? ast : [ast];

    statements.forEach((statement) => {
        if (statement.type === 'select') {
            const columns = statement.columns;
            const schema = statement.from?.[0]?.db;
            const table = statement.from?.[0]?.table;

            if (columns.length === 1 && columns[0].expr.type === 'star') {
                columnsMap.push({
                    schema,
                    table,
                    original: '*',
                    alias: null,
                    functionName: null
                });
            } else {
                // Existing logic for specific columns
                columns.forEach((column: any) => {
                    let originalColumn = '';
                    let alias = column.as;
                    let functionName = null;

                    if (column.expr.type === 'column_ref') {
                        originalColumn = column.expr.column;
                    } else if (column.expr.type === 'function') {
                        functionName = column.expr.name;
                        column.expr.args.value.forEach((arg: any) => {
                            if (arg.type === 'column_ref') {
                                originalColumn += (originalColumn ? ',' : '') + arg.column;
                            }
                        });

                        // If there's no alias, use the function expression as a placeholder
                        if (!alias) {
                            alias = `${functionName}(${originalColumn})`;
                        }
                    }

                    if (originalColumn) {
                        columnsMap.push({
                            schema,
                            table,
                            original: originalColumn,
                            alias,
                            functionName
                        });
                    }
                });
            }
        }
    });

    try {
        let cursor;
        
        if (params && params.length) {
            cursor = sqlInstance.exec(sql, ...params);
        } else {
            cursor = sqlInstance.exec(sql);
        }

        let result;

        if (isRaw) {
            result = {
                columns: cursor.columnNames,
                rows: cursor.raw().toArray(),
                meta: {
                    rows_read: cursor.rowsRead,
                    rows_written: cursor.rowsWritten,
                },
            };        
        } else {
            result = cursor.toArray();
        }

        // Apply masking to the result
        let maskedResult;

        if (isRaw) {
            maskedResult = {
                ...result,
                rows: result.rows.map((row: any) => maskRow(row, result.columns, columnsToMask, columnsMap))
            };
        } else {
            maskedResult = result.map((row: any) => maskRow(row, undefined, columnsToMask, columnsMap));
        }

        return maskedResult;
    } catch (error) {
        console.error('SQL Execution Error:', error);
        throw error;
    }
}

function maskRow(row: any, columns: any[] | undefined, columnsToMask: Record<string, any>[], columnsMap: Record<string, any>[]) {
    const defaultSchemaName = 'main';

    if (columns) {
        columnsToMask.forEach(maskColumn => {
            // Helper function to check if schemas match
            const schemasMatch = (schema1: string | null, schema2: string | null) => {
                return (!schema1 && !schema2) || 
                       (!schema1 && schema2?.toLowerCase() === defaultSchemaName) ||
                       (!schema2 && schema1?.toLowerCase() === defaultSchemaName) ||
                       (schema1?.toLowerCase() === schema2?.toLowerCase());
            };

            // Find all matching columns using the same logic as non-columns case
            const matchingColumns = columnsMap.filter(mapColumn => {
                // Handle SELECT *
                if (mapColumn.original === '*') {
                    return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                           mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase();
                }
                
                // Handle comma-separated columns in functions
                if (mapColumn.original?.includes(',')) {
                    const cols = mapColumn.original.split(',').map((col: string) => col.toLowerCase());
                    return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                           mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase() &&
                           cols.includes(maskColumn.original?.toLowerCase());
                }
                
                // Handle regular columns
                return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                       mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase() &&
                       mapColumn.original?.toLowerCase() === maskColumn.original?.toLowerCase();
            });

            matchingColumns.forEach(matchingColumn => {
                // Find the correct column name in the result set
                let columnToFind = matchingColumn.original === '*' 
                    ? maskColumn.original 
                    : (matchingColumn.alias || matchingColumn.original);
                
                // Find index of the column in the results
                const index = columns.findIndex((column: string) => 
                    column.toLowerCase() === columnToFind?.toLowerCase()
                );

                // If the column exists, mask it
                if (index !== -1) {
                    row[index] = maskDataWithMethod(row[index], maskColumn.method);
                }
            });
        });
    }

    if (!columns) {
        columnsToMask.forEach(maskColumn => {
            // Helper function to check if schemas match
            const schemasMatch = (schema1: string | null, schema2: string | null) => {
                return (!schema1 && !schema2) || 
                       (!schema1 && schema2?.toLowerCase() === defaultSchemaName) ||
                       (!schema2 && schema1?.toLowerCase() === defaultSchemaName) ||
                       (schema1?.toLowerCase() === schema2?.toLowerCase());
            };
    
            const matchingColumns = columnsMap.filter(mapColumn => {
                // Handle SELECT *
                if (mapColumn.original === '*') {
                    return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                           mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase();
                }
                
                // Handle comma-separated columns in functions
                if (mapColumn.original?.includes(',')) {
                    const columns = mapColumn.original.split(',').map((col: string) => col.toLowerCase());
                    return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                           mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase() &&
                           columns.includes(maskColumn.original?.toLowerCase());
                }
                
                // Handle regular columns
                return schemasMatch(mapColumn.schema, maskColumn.schema) &&
                       mapColumn.table?.toLowerCase() === maskColumn.table?.toLowerCase() &&
                       mapColumn.original?.toLowerCase() === maskColumn.original?.toLowerCase();
            });
    
            matchingColumns.forEach(matchingColumn => {
                if (matchingColumn.original === '*') {
                    // If it's a SELECT *, only mask the specific column we want
                    let columnName = maskColumn.original?.toLowerCase();
                    if (row[columnName] !== undefined) {
                        row[columnName] = maskDataWithMethod(row[columnName], maskColumn.method);
                    }
                } else {
                    // For both regular columns and function results
                    let columnName = matchingColumn.alias?.toLowerCase() || matchingColumn.original?.toLowerCase();
                    if (row[columnName] !== undefined) {
                        row[columnName] = maskDataWithMethod(row[columnName], maskColumn.method);
                    }
                }
            });
        });
    }

    return row;
}

export async function executeTransaction(queries: { sql: string; params?: any[] }[], isRaw: boolean, sqlInstance: any, ctx: any): Promise<any[]> {
    return ctx.storage.transactionSync(() => {
        const results = [];

        try {
            for (const queryObj of queries) {
                const { sql, params } = queryObj;
                const result = executeQuery(sql, params, isRaw, sqlInstance);
                results.push(result);
            }

            return results;
        } catch (error) {
            console.error('Transaction Execution Error:', error);
            throw error;
        }
    });
}

export async function enqueueOperation(
    queries: { sql: string; params?: any[] }[],
    isTransaction: boolean,
    isRaw: boolean,
    operationQueue: any[],
    processNextOperation: () => Promise<void>
): Promise<{ result?: any, error?: string | undefined, status: number }> {
    const MAX_WAIT_TIME = 25000;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(createResponse(undefined, 'Operation timed out.', 503));
        }, MAX_WAIT_TIME);

        operationQueue.push({
            queries,
            isTransaction,
            isRaw,
            resolve: (value: any) => {
                clearTimeout(timeout);

                resolve({
                    result: value,
                    error: undefined,
                    status: 200
                })
            },
            reject: (reason?: any) => {
                clearTimeout(timeout);

                reject({
                    result: undefined,
                    error: reason ?? 'Operation failed.',
                    status: 500
                })
            }
        });

        processNextOperation().catch((err) => {
            console.error('Error processing operation queue:', err);
        });
    });
}

export async function processNextOperation(
    sqlInstance: any,
    operationQueue: OperationQueueItem[],
    ctx: any,
    processingOperation: { value: boolean }
) {
    if (processingOperation.value) {
        // Already processing an operation
        return;
    }

    if (operationQueue.length === 0) {
        // No operations remaining to process
        return;
    }

    processingOperation.value = true;
    const { queries, isTransaction, isRaw, resolve, reject } = operationQueue.shift()!;

    try {
        let result;

        if (isTransaction) {
            result = await executeTransaction(queries, isRaw, sqlInstance, ctx);
        } else {
            const { sql, params } = queries[0];
            result = executeQuery(sql, params, isRaw, sqlInstance);
        }

        resolve(result);
    } catch (error: any) {
        reject(error.message || 'Operation failed.');
    } finally {
        processingOperation.value = false;
        await processNextOperation(sqlInstance, operationQueue, ctx, processingOperation);
    }
}
