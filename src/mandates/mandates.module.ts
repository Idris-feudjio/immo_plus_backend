import { Global, Module } from '@nestjs/common';
import { MandateRepository } from './mandate.repository';
import { MandateGuard } from '../common/guards/mandate.guard';

@Global()
@Module({
  providers: [MandateRepository, MandateGuard],
  exports: [MandateRepository, MandateGuard],
})
export class MandatesModule {}
