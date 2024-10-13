import { getTableData, createExportResponse } from './index';
import { createResponse } from '../utils';

export async function exportTableToCsvRoute(
    sql: any,
    operationQueue: any,
    ctx: any,
    processingOperation: { value: boolean },
    tableName: string
): Promise<Response> {
    try {
        const data = await getTableData(sql, operationQueue, ctx, processingOperation, tableName);

        if (data === null) {
            return createResponse(undefined, `Table '${tableName}' does not exist.`, 404);
        }

        // Convert the result to CSV
        let csvContent = '';
        if (data.length > 0) {
            // Add headers
            csvContent += Object.keys(data[0]).join(',') + '\n';

            // Add data rows
            data.forEach((row: any) => {
                csvContent += Object.values(row).map(value => {
                    if (typeof value === 'string' && value.includes(',')) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(',') + '\n';
            });
        }

        return createExportResponse(csvContent, `${tableName}_export.csv`, 'text/csv');
    } catch (error: any) {
        console.error('CSV Export Error:', error);
        return createResponse(undefined, 'Failed to export table to CSV', 500);
    }
}
