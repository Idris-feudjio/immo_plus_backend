import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyRepository } from './property.repository';
import { PROPERTY_SERVICE } from './interfaces/property-service.interface';

@Module({
  controllers: [PropertiesController],
  providers: [
    PropertyRepository,
    { provide: PROPERTY_SERVICE, useClass: PropertiesService },
  ],
  exports: [PROPERTY_SERVICE, PropertyRepository],
})
export class PropertiesModule {}
