import { enqueueOperation, processNextOperation } from '../operation';

export async function getTableData(
    sql: any,
    operationQueue: any,
    ctx: any,
    processingOperation: { value: boolean },
    tableName: string
): Promise<any[] | null> {
    try {
        // Verify if the table exists
        const tableExistsResult = await enqueueOperation(
            [{ sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?;`, params: [tableName] }],
            false,
            false,
            operationQueue,
            () => processNextOperation(sql, operationQueue, ctx, processingOperation)
        );

        if (tableExistsResult.result.length === 0) {
            return null;
        }

        // Get table data
        const dataResult = await enqueueOperation(
            [{ sql: `SELECT * FROM ${tableName};` }],
            false,
            false,
            operationQueue,
            () => processNextOperation(sql, operationQueue, ctx, processingOperation)
        );

        return dataResult.result;
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

