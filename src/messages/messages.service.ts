import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/dto/pagination.dto';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async getConversations(userId: string) {
    const messages = await this.prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      include: {
        sender: { select: { id: true, lastName: true, firstName: true, avatarUrl: true } },
        recipient: { select: { id: true, lastName: true, firstName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const conversations = new Map<string, any>();

    for (const msg of messages) {
      const contactId = msg.senderId === userId ? msg.recipientId : msg.senderId;
      const contact = msg.senderId === userId ? msg.recipient : msg.sender;

      if (!conversations.has(contactId)) {
        const unreadCount = await this.prisma.message.count({
          where: { senderId: contactId, recipientId: userId, isRead: false },
        });
        conversations.set(contactId, {
          contact,
          lastMessage: { content: msg.content, createdAt: msg.createdAt },
          unreadCount,
        });
      }
    }

    return { data: Array.from(conversations.values()) };
  }

  async getMessages(userId: string, contactId: string, query: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, recipientId: contactId },
            { senderId: contactId, recipientId: userId },
          ],
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.message.count({
        where: {
          OR: [
            { senderId: userId, recipientId: contactId },
            { senderId: contactId, recipientId: userId },
          ],
        },
      }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async sendMessage(senderId: string, recipientId: string, content: string, attachmentUrl?: string) {
    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw new NotFoundException('Destinataire introuvable.');

    const message = await this.prisma.message.create({
      data: { senderId, recipientId, content, attachmentUrl },
      include: {
        sender: { select: { id: true, lastName: true, firstName: true, avatarUrl: true } },
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'new_message',
        title: 'Nouveau message',
        body: `Vous avez reçu un message de ${message.sender.firstName} ${message.sender.lastName}.`,
      },
    });

    return message;
  }

  async markAsRead(userId: string, contactId: string) {
    await this.prisma.message.updateMany({
      where: { senderId: contactId, recipientId: userId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'Messages marqués comme lus.' };
  }
}
