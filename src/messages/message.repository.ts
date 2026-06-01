import { Injectable, NotFoundException } from '@nestjs/common';
import { Message, User } from '@prisma/client';
import {
  BaseRepository,
  PrismaModelDelegate,
} from '../common/abstractions/base.repository';
import type { PaginatedResult } from '../common/interfaces/paginated-result.interface';
import type { QueryField } from '../common/interfaces/search-request.interface';
import { buildMeta } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';

export type MessageCreateData = {
  senderId: string;
  recipientId: string;
  content: string;
  attachmentUrl?: string;
};

const MESSAGE_QUERY_FIELDS: QueryField[] = [
  { filterKey: 'content', prismaField: 'content', searchable: true },
  { filterKey: 'createdAt', prismaField: 'createdAt', sortable: true },
];

const USER_MINI_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  avatarUrl: true,
} as const;

@Injectable()
export class MessageRepository extends BaseRepository<Message, MessageCreateData> {
  constructor(private readonly prisma: PrismaService) {
    super(
      prisma.message as unknown as PrismaModelDelegate<Message>,
      MESSAGE_QUERY_FIELDS,
    );
  }

  /** All messages where user is sender or recipient, with user details included. */
  findAllForUser(userId: string): Promise<(Message & { sender: Partial<User>; recipient: Partial<User> })[]> {
    return this.prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      include: {
        sender: { select: USER_MINI_SELECT },
        recipient: { select: USER_MINI_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    }) as never;
  }

  countUnreadFrom(senderId: string, recipientId: string): Promise<number> {
    return this.prisma.message.count({
      where: { senderId, recipientId, isRead: false },
    });
  }

  /** Paginated messages between two users. */
  async findBetween(
    userId: string,
    contactId: string,
    query: { page?: number; limit?: number },
  ): Promise<PaginatedResult<Message>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      OR: [
        { senderId: userId, recipientId: contactId },
        { senderId: contactId, recipientId: userId },
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { data, meta: buildMeta(total, page - 1, limit) };
  }

  async markConversationRead(senderId: string, recipientId: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { senderId, recipientId, isRead: false },
      data: { isRead: true },
    });
  }

  async findRecipientOrThrow(recipientId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!user) throw new NotFoundException('Destinataire introuvable.');
    return user;
  }

  async createWithSender(data: MessageCreateData): Promise<Message & { sender: Partial<User> }> {
    return this.prisma.message.create({
      data,
      include: { sender: { select: USER_MINI_SELECT } },
    }) as never;
  }

  async createNotification(notification: {
    userId: string;
    type: string;
    title: string;
    body: string;
  }): Promise<void> {
    await this.prisma.notification.create({ data: notification });
  }
}
