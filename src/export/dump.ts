import { executeOperation } from '.';
import { DataSource } from '../types';
import { createResponse } from '../utils';

export async function dumpDatabaseRoute(
    dataSource: DataSource
): Promise<Response> {
    try {
        // Get all table names
        const tablesResult = await executeOperation([{ sql: "SELECT name FROM sqlite_master WHERE type='table';" }], dataSource)
        
        const tables = tablesResult.map((row: any) => row.name);
        let dumpContent = "SQLite format 3\0";  // SQLite file header

        // Iterate through all tables
        for (const table of tables) {
            // Get table schema
            const schemaResult = await executeOperation([{ sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}';` }], dataSource)

            if (schemaResult.length) {
                const schema = schemaResult[0].sql;
                dumpContent += `\n-- Table: ${table}\n${schema};\n\n`;
            }

            // Get table data
            const dataResult = await executeOperation([{ sql: `SELECT * FROM ${table};` }], dataSource)

            for (const row of dataResult) {
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
