import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UnitOfWorkService } from './unit-of-work.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [UnitOfWorkService],
  exports: [UnitOfWorkService],
})
export class DatabaseModule {}
