import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApplicationStatus, Role } from '@prisma/client';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FileValidationPipe } from '../common/pipes/file-validation.pipe';
import { SearchRequestDto } from '../common/dto/pagination.dto';
import { ApplicationsService } from './applications.service';
import { SubmitApplicationDto } from './dto/application.dto';

const ALLOWED_ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

@ApiTags('Applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Post()
  @Roles(Role.TENANT)
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Soumettre un dossier de candidature (locataire connecté)',
  })
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitApplicationDto) {
    return this.service.submit(user, dto);
  }

  @Post(':id/attachments')
  @Roles(Role.TENANT)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ajouter des pièces jointes à un dossier de candidature',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('attachments[]', 5, {
      limits: { fileSize: MAX_ATTACHMENT_SIZE },
    }),
  )
  addAttachments(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @UploadedFiles(
      new FileValidationPipe(ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_SIZE),
    )
    files: Express.Multer.File[],
  ) {
    return this.service.addAttachments(user, id, files);
  }

  @Get('me')
  @Roles(Role.TENANT)
  @ApiOperation({ summary: 'Mes candidatures (locataire) — Mon Espace' })
  findMine(@CurrentUser() user: AuthUser) {
    return this.service.findMyApplications(user.id);
  }

  @Post('search')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Lister les candidatures d'un bien (Owner/Manager/Admin)",
  })
  search(@CurrentUser() user: AuthUser, @Body() body: SearchRequestDto) {
    return this.service.search(user, body);
  }

  @Patch(':id/accept')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accepter une candidature' })
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.updateStatus(user, id, ApplicationStatus.ACCEPTED);
  }

  @Patch(':id/reject')
  @Roles(Role.OWNER, Role.MANAGER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejeter une candidature' })
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.updateStatus(user, id, ApplicationStatus.REJECTED);
  }
}
