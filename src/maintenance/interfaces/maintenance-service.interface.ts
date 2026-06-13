import { MaintenanceRequest } from '@prisma/client';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import type {
  CreateMaintenanceDto,
  FilterMaintenanceDto,
  UpdateMaintenanceStatusDto,
} from '../dto/maintenance.dto';

export const MAINTENANCE_SERVICE = 'IMaintenanceService';

export interface IMaintenanceService {
  create(user: AuthUser, dto: CreateMaintenanceDto): Promise<MaintenanceRequest>;
  updateStatus(
    user: AuthUser,
    id: string,
    dto: UpdateMaintenanceStatusDto,
  ): Promise<MaintenanceRequest>;
  list(
    user: AuthUser,
    query: FilterMaintenanceDto,
  ): Promise<{ data: MaintenanceRequest[]; total: number; page: number; limit: number }>;
  getMyRequests(userId: string): Promise<{ data: unknown[] }>;
  addPhotos(
    user: AuthUser,
    id: string,
    files: Express.Multer.File[],
  ): Promise<{ images: string[] }>;
}
