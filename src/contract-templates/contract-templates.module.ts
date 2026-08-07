import { Module } from '@nestjs/common';
import { ContractTemplatesController } from './contract-templates.controller';
import { ContractTemplateRepository } from './contract-template.repository';
import { ContractTemplatesService } from './contract-templates.service';

@Module({
  controllers: [ContractTemplatesController],
  providers: [ContractTemplateRepository, ContractTemplatesService],
  exports: [ContractTemplatesService],
})
export class ContractTemplatesModule {}
