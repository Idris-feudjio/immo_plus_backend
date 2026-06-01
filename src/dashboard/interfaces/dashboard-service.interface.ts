export const DASHBOARD_SERVICE = 'IDashboardService';

export interface IDashboardService {
  getOwnerStats(userId: string, role: string): Promise<unknown>;
  getTenantDashboard(userId: string): Promise<unknown>;
  getMaintenanceRequests(userId: string, role: string, query: Record<string, unknown>): Promise<unknown>;
  createMaintenanceRequest(userId: string, body: Record<string, unknown>): Promise<unknown>;
  updateMaintenanceRequest(id: string, body: Record<string, unknown>): Promise<unknown>;
}
