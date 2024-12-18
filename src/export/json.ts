import { getTableData, createExportResponse } from './index'
import { createResponse } from '../utils'
import { DataSource } from '../types'

export async function exportTableToJsonRoute(
    tableName: string,
    dataSource: DataSource
): Promise<Response> {
    try {
        const data = await getTableData(tableName, dataSource)

        if (data === null) {
            return createResponse(
                undefined,
                `Table '${tableName}' does not exist.`,
                404
            )
        }

        // Convert the result to JSON
        const jsonData = JSON.stringify(data, null, 4)

        return createExportResponse(
            jsonData,
            `${tableName}_export.json`,
            'application/json'
        )
    } catch (error: any) {
        console.error('JSON Export Error:', error)
        return createResponse(undefined, 'Failed to export table to JSON', 500)
    }
}
