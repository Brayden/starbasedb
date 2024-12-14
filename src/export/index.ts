import { DataSource } from "../types";
import { executeTransaction } from "../operation";

export async function executeOperation(queries: { sql: string, params?: any[] }[], dataSource: DataSource): Promise<any> {
    const results: any[] = (await executeTransaction(queries, false, dataSource)) as any[];
    return results?.length > 0 ? results[0] : undefined;
}

export async function getTableData(
    tableName: string,
    dataSource: DataSource
): Promise<any[] | null> {
    try {
        // Verify if the table exists
        const tableExistsResult = await executeOperation([{ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`, params: [tableName] }], dataSource)

        if (tableExistsResult.length === 0) {
            return null;
        }

        // Get table data
        const dataResult = await executeOperation([{ sql: `SELECT * FROM ${tableName};` }], dataSource)
        return dataResult;
    } catch (error: any) {
        console.error('Table Data Fetch Error:', error);
        throw error;
    }
}

export function createExportResponse(data: any, fileName: string, contentType: string): Response {
    const blob = new Blob([data], { type: contentType });

    const headers = new Headers({
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    return new Response(blob, { headers });
}

