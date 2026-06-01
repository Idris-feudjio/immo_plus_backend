import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { IMessagesService } from './interfaces/message-service.interface';
import { MESSAGES_SERVICE } from './interfaces/message-service.interface';

@ApiTags('Messages')
@Controller('messages')
export class MessagesController {
  constructor(
    @Inject(MESSAGES_SERVICE) private readonly service: IMessagesService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'Liste des conversations' })
  getConversations(@CurrentUser() user: AuthUser) {
    return this.service.getConversations(user.id);
  }

  @Get(':userId')
  @ApiOperation({ summary: "Messages d'une conversation" })
  getMessages(
    @Param('userId') contactId: string,
    @CurrentUser() user: AuthUser,
    @Query() query: { page?: number; limit?: number },
  ) {
    return this.service.getMessages(user.id, contactId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Envoyer un message' })
  send(
    @CurrentUser() user: AuthUser,
    @Body() body: { recipientId: string; content: string; attachmentUrl?: string },
  ) {
    return this.service.sendMessage(user.id, body.recipientId, body.content, body.attachmentUrl);
  }

  @Patch(':conversationUserId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer comme lu' })
  markAsRead(@Param('conversationUserId') contactId: string, @CurrentUser() user: AuthUser) {
    return this.service.markAsRead(user.id, contactId);
  }

  @Post('attachments')
  @ApiOperation({ summary: 'Upload pièce jointe' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(@UploadedFile() _file: Express.Multer.File) {
    // TODO: upload to storage
    return { url: 'https://placeholder/attachment' };
  }
}
