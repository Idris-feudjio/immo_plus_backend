import { Message } from '@prisma/client';
import type { PaginatedResult } from '../../common/interfaces/paginated-result.interface';

export const MESSAGES_SERVICE = 'IMessagesService';

export interface ConversationItem {
  contact: {
    id: string;
    lastName: string;
    firstName: string;
    avatarUrl: string | null;
  };
  lastMessage: { content: string; createdAt: Date };
  unreadCount: number;
}

export interface IMessagesService {
  getConversations(userId: string): Promise<{ data: ConversationItem[] }>;
  getMessages(
    userId: string,
    contactId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Message>>;
  sendMessage(
    senderId: string,
    recipientId: string,
    content: string,
    attachmentUrl?: string,
  ): Promise<Message>;
  markAsRead(userId: string, contactId: string): Promise<{ message: string }>;
}
