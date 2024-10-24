import { WorkerEntrypoint } from "cloudflare:workers";
import { Parser } from 'node-sql-parser';

enum DataMaskingMode {
    NULL = "null",
    REDACT = "redact",
    RANDOM = "random"
}

export default class DataMaskingEntrypoint extends WorkerEntrypoint {
    // Currently, entrypoints without a named handler are not supported
    async fetch() { return new Response(null, {status: 404}); }

    async maskQueryResult(sql: string, result: any, isRaw: boolean, maskingRules: any): Promise<any> {
        const maskingRulesMapped = maskingRules?.map((rule: any) => ({
            schema: rule.schema_name,
            table: rule.table_name,
            original: rule.column_name,
            method: rule.masking_mode
        }));
        const sqlColumnsMap = await this.getMaskingColumnsMap(sql);

        let maskedResult;

        if (isRaw) {
            maskedResult = {
                ...result,
                rows: result.rows.map((row: any) => this.maskRow(row, result.columns, maskingRulesMapped, sqlColumnsMap))
            };
        } else {
            maskedResult = result.map((row: any) => this.maskRow(row, undefined, maskingRulesMapped, sqlColumnsMap));
        }

        return maskedResult;
    }

    async getMaskingColumnsMap(sql: string): Promise<Record<string, any>[]> {
        const parser = new Parser();
        const ast: any = parser.astify(sql);
        let columnsMap: Record<string, any>[] = [];

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

        return columnsMap;
    }

    maskDataWithMethod(data: any, maskingMode: DataMaskingMode): string | null {
        switch (maskingMode) {
            case DataMaskingMode.NULL:
                return null;
            case DataMaskingMode.REDACT:
                return '*******';
            case DataMaskingMode.RANDOM:
                return Math.random().toString(36).substring(2, 15);
        }
    }

    maskRow(row: any, columns: any[] | undefined, columnsToMask: Record<string, any>[], columnsMap: Record<string, any>[]) {
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
                        row[index] = this.maskDataWithMethod(row[index], maskColumn.method);
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
                            row[columnName] = this.maskDataWithMethod(row[columnName], maskColumn.method);
                        }
                    } else {
                        // For both regular columns and function results
                        let columnName = matchingColumn.alias?.toLowerCase() || matchingColumn.original?.toLowerCase();
                        if (row[columnName] !== undefined) {
                            row[columnName] = this.maskDataWithMethod(row[columnName], maskColumn.method);
                        }
                    }
                });
            });
        }
    
        return row;
    }
}
