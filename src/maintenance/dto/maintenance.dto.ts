import { MaintenanceStatus, MaintenanceUrgency } from '@prisma/client';

export class CreateMaintenanceDto {
  propertyId!: string;
  title!: string;
  description!: string;
  urgency?: MaintenanceUrgency;
  images?: string[];
}

export class UpdateMaintenanceStatusDto {
  status!: MaintenanceStatus;
  comment?: string;
}

export class FilterMaintenanceDto {
  status?: MaintenanceStatus;
  urgency?: MaintenanceUrgency;
  propertyId?: string;
  page?: number;
  limit?: number;
}
