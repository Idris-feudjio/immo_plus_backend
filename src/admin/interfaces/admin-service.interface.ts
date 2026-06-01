export const ADMIN_SERVICE = 'IAdminService';

export interface IAdminService {
  getGlobalStats(): Promise<unknown>;
  getSettings(): Promise<unknown>;
  updateSettings(body: Record<string, unknown>): Promise<unknown>;
}
