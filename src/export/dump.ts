import { enqueueOperation, processNextOperation } from '../operation';
import { createResponse } from '../utils';

export async function dumpDatabaseRoute(
    sql: any,
    operationQueue: any,
    ctx: any,
    processingOperation: { value: boolean }
): Promise<Response> {
    try {
        // Get all table names
        const tablesResult = await enqueueOperation(
            [{ sql: "SELECT name FROM sqlite_master WHERE type='table';" }],
            false,
            false,
            operationQueue,
            () => processNextOperation(sql, operationQueue, ctx, processingOperation)
        );
        
        const tables = tablesResult.result.map((row: any) => row.name);
        let dumpContent = "SQLite format 3\0";  // SQLite file header

        // Iterate through all tables
        for (const table of tables) {
            // Get table schema
            const schemaResult = await enqueueOperation(
                [{ sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}';` }],
                false,
                false,
                operationQueue,
                () => processNextOperation(sql, operationQueue, ctx, processingOperation)
            );

            if (schemaResult.result.length) {
                const schema = schemaResult.result[0].sql;
                dumpContent += `\n-- Table: ${table}\n${schema};\n\n`;
            }

            // Get table data
            const dataResult = await enqueueOperation(
                [{ sql: `SELECT * FROM ${table};` }],
                false,
                false,
                operationQueue,
                () => processNextOperation(sql, operationQueue, ctx, processingOperation)
            );

            for (const row of dataResult.result) {
                const values = Object.values(row).map(value => 
                    typeof value === 'string' ? `'${value.replace(/'/g, "''")}'` : value
                );
                dumpContent += `INSERT INTO ${table} VALUES (${values.join(', ')});\n`;
            }

            dumpContent += '\n';
        }

        // Create a Blob from the dump content
        const blob = new Blob([dumpContent], { type: 'application/x-sqlite3' });

        const headers = new Headers({
            'Content-Type': 'application/x-sqlite3',
            'Content-Disposition': 'attachment; filename="database_dump.sql"',
        });

        return new Response(blob, { headers });
    } catch (error: any) {
        console.error('Database Dump Error:', error);
        return createResponse(undefined, 'Failed to create database dump', 500);
    }
}
