import { Module } from '@nestjs/common';
import { PdfService } from '../common/services/pdf.service';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractRepository } from './contract.repository';
import { CONTRACTS_SERVICE } from './interfaces/contracts-service.interface';

@Module({
  controllers: [ContractsController],
  providers: [
    ContractRepository,
    PdfService,
    { provide: CONTRACTS_SERVICE, useClass: ContractsService },
  ],
  exports: [CONTRACTS_SERVICE, ContractRepository],
})
export class ContractsModule {}
