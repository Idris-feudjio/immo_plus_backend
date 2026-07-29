import { Module } from '@nestjs/common';
import { MandatesModule } from '../mandates/mandates.module';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { AgencyRepository } from './agency.repository';

@Module({
  imports: [MandatesModule],
  controllers: [AgenciesController],
  providers: [AgencyRepository, AgenciesService],
  exports: [AgenciesService],
})
export class AgenciesModule {}
