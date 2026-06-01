import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ADMIN_SERVICE } from './interfaces/admin-service.interface';

@Module({
  controllers: [AdminController],
  providers: [{ provide: ADMIN_SERVICE, useClass: AdminService }],
  exports: [ADMIN_SERVICE],
})
export class AdminModule {}
