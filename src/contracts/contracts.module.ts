import { Module } from '@nestjs/common';
import { PdfService } from '../common/services/pdf.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractRepository } from './contract.repository';
@Module({
  controllers: [ContractsController],
  providers: [ContractRepository, PdfService, ContractsService],
  exports: [ContractsService, ContractRepository],
})
export class ContractsModule {}
