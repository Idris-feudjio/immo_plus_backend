import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENTS_SERVICE } from './interfaces/documents-service.interface';

@Module({
  controllers: [DocumentsController],
  providers: [{ provide: DOCUMENTS_SERVICE, useClass: DocumentsService }],
  exports: [DOCUMENTS_SERVICE],
})
export class DocumentsModule {}
