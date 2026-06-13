import { Module } from '@nestjs/common';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { AGENCY_SERVICE } from './interfaces/agency-service.interface';

@Module({
  controllers: [AgenciesController],
  providers: [{ provide: AGENCY_SERVICE, useClass: AgenciesService }],
  exports: [AGENCY_SERVICE],
})
export class AgenciesModule {}
