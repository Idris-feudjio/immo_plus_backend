import { Injectable } from '@nestjs/common';
import { Message } from '@prisma/client';
import { BaseService } from '../common/abstractions/base.service';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { ConversationItem, IMessagesService } from './interfaces/message-service.interface';
import { MessageCreateData, MessageRepository } from './message.repository';

@Injectable()
export class MessagesService
  extends BaseService<Message, MessageCreateData>
  implements IMessagesService
{
  constructor(protected override readonly repository: MessageRepository) {
    super(repository);
  }

  async getConversations(userId: string): Promise<{ data: ConversationItem[] }> {
    const messages = await this.repository.findAllForUser(userId);
    const conversations = new Map<string, ConversationItem>();

    for (const msg of messages) {
      const contactId = msg.senderId === userId ? msg.recipientId : msg.senderId;
      const contact = (
        msg.senderId === userId
          ? (msg as never as { recipient: ConversationItem['contact'] }).recipient
          : (msg as never as { sender: ConversationItem['contact'] }).sender
      );

      if (!conversations.has(contactId)) {
        const unreadCount = await this.repository.countUnreadFrom(contactId, userId);
        conversations.set(contactId, {
          contact,
          lastMessage: { content: msg.content, createdAt: msg.createdAt },
          unreadCount,
        });
      }
    }

    return { data: Array.from(conversations.values()) };
  }

  getMessages(
    userId: string,
    contactId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Message>> {
    return this.repository.findBetween(userId, contactId, query);
  }

  async sendMessage(
    senderId: string,
    recipientId: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<Message> {
    await this.repository.findRecipientOrThrow(recipientId);
    const message = await this.repository.createWithSender({ senderId, recipientId, content, attachmentUrl });
    const sender = (message as never as { sender: { firstName: string; lastName: string } }).sender;

    await this.repository.createNotification({
      userId: recipientId,
      type: 'new_message',
      title: 'Nouveau message',
      body: `Vous avez reçu un message de ${sender.firstName} ${sender.lastName}.`,
    });

    return message;
  }

  async markAsRead(userId: string, contactId: string): Promise<{ message: string }> {
    await this.repository.markConversationRead(contactId, userId);
    return { message: 'Messages marqués comme lus.' };
  }
}
