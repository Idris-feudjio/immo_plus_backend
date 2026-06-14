import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessageRepository } from './message.repository';
@Module({
  controllers: [MessagesController],
  providers: [MessageRepository, MessagesService],
  exports: [MessagesService, MessageRepository],
})
export class MessagesModule {}
