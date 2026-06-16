import { Module } from '@nestjs/common';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { AgencyRepository } from './agency.repository';

@Module({
  controllers: [AgenciesController],
  providers: [AgencyRepository, AgenciesService],
  exports: [AgenciesService],
})
export class AgenciesModule {}
