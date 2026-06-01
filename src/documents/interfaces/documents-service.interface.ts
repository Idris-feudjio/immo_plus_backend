export const DOCUMENTS_SERVICE = 'IDocumentsService';

export interface IDocumentsService {
  getFinancialReport(
    userId: string,
    role: string,
    query: { startDate?: string; endDate?: string; propertyId?: string },
  ): Promise<unknown>;
  getOccupancyReport(
    userId: string,
    role: string,
    query: { year?: number; propertyId?: string },
  ): Promise<unknown>;
  createExportJob(
    userId: string,
    params: { type: string; startDate?: string; endDate?: string; propertyId?: string },
  ): Promise<unknown>;
  getExportStatus(jobId: string): Promise<unknown>;
  getProfitability(
    propertyId: string,
    userId: string,
    role: string,
    query: { startDate?: string; endDate?: string },
  ): Promise<unknown>;
}
