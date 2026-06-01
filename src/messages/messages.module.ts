import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessageRepository } from './message.repository';
import { MESSAGES_SERVICE } from './interfaces/message-service.interface';

@Module({
  controllers: [MessagesController],
  providers: [
    MessageRepository,
    { provide: MESSAGES_SERVICE, useClass: MessagesService },
  ],
  exports: [MESSAGES_SERVICE, MessageRepository],
})
export class MessagesModule {}
