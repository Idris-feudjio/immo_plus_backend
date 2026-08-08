import { Module } from '@nestjs/common';
import { PdfService } from '../common/services/pdf.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractTemplatesModule } from '../contract-templates/contract-templates.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractRepository } from './contract.repository';
@Module({
  imports: [NotificationsModule, ContractTemplatesModule],
  controllers: [ContractsController],
  providers: [ContractRepository, PdfService, ContractsService],
  exports: [ContractsService, ContractRepository],
})
export class ContractsModule {}
