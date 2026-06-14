import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyRepository } from './property.repository';

@Module({
  controllers: [PropertiesController],
  providers: [PropertyRepository, PropertiesService],
  exports: [PropertiesService, PropertyRepository],
})
export class PropertiesModule {}
