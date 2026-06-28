import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../notifications/email-queue.service.js';
import { CacheService } from '../cache/cache.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResetPasswordDto, ChangePasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private emailQueue: EmailQueueService,
    private cache: CacheService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Les mots de passe ne correspondent pas.');
    }

    const email = dto.email.toLowerCase();

    const existingEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      throw new ConflictException({ error: 'EMAIL_ALREADY_EXISTS', message: 'Email déjà utilisé.' });
    }

    if (dto.phone) {
      const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existingPhone) {
        throw new ConflictException('Numéro de téléphone déjà utilisé.');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const allowedRoles = ['OWNER', 'TENANT'] as const;
    if (!allowedRoles.includes(dto.role as typeof allowedRoles[number])) {
      throw new BadRequestException('Rôle non autorisé à l\'inscription.');
    }

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
      },
      select: { id: true, firstName: true, email: true },
    });

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId: user.id, code: otp, expiresAt },
    });

    await this.emailQueue.sendEmail({
      to: user.email,
      subject: 'Votre code de vérification Immo Plus CM',
      template: 'otp',
      data: { name: user.firstName, otp },
    });

    return {
      message: 'Compte créé. Vérifiez votre email pour activer votre compte.',
      userId: user.id,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    if (user.emailVerified) {
      return { message: 'Email déjà vérifié.' };
    }

    const attemptsKey = `otp_attempts:${user.id}`;

    // Pre-check: reject immediately if 3+ failed attempts already recorded
    const currentAttempts = await this.cache.get<number>(attemptsKey);
    if (currentAttempts !== null && currentAttempts >= 3) {
      throw new BadRequestException({ error: 'OTP_MAX_ATTEMPTS', message: 'Trop de tentatives. Demandez un nouveau code.' });
    }

    // Find OTP by code WITHOUT expiry filter — allows distinguishing expired vs wrong code
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { userId: user.id, code: dto.otp, usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true },
    });

    if (!otpRecord) {
      const count = await this.cache.incr(attemptsKey, 600);
      if (count >= 3) {
        await this.prisma.otpCode.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        throw new BadRequestException({ error: 'OTP_MAX_ATTEMPTS', message: 'Trop de tentatives. Demandez un nouveau code.' });
      }
      throw new BadRequestException({ error: 'OTP_INVALID', message: 'Code OTP incorrect.' });
    }

    if (otpRecord.expiresAt < new Date()) {
      throw new BadRequestException({ error: 'OTP_EXPIRED', message: 'Code OTP expiré. Demandez un nouveau code.' });
    }

    await this.cache.del(attemptsKey);

    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { usedAt: new Date() },
    });

    if (!user.isActive) {
      throw new ForbiddenException({ error: 'ACCOUNT_DISABLED', message: 'Votre compte a été désactivé.' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    return this.generateAuthResponse(user.id, user.email, user.role);
  }

  async resendOtp(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentAttempts = await this.prisma.otpCode.count({
      where: { userId, createdAt: { gt: tenMinutesAgo } },
    });

    if (recentAttempts >= 3) {
      throw new BadRequestException({ error: 'OTP_RESEND_LIMIT', message: 'Trop de tentatives. Réessayez dans 10 minutes.' });
    }

    await this.prisma.otpCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.cache.del(`otp_attempts:${userId}`);

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.prisma.otpCode.create({ data: { userId, code: otp, expiresAt } });

    await this.emailQueue.sendEmail({
      to: user.email,
      subject: 'Votre nouveau code de vérification Immo Plus CM',
      template: 'otp',
      data: { name: user.firstName, otp },
    });

    return { message: 'OTP renvoyé avec succès.' };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, passwordHash: true, emailVerified: true, isActive: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect.' });
    }

    const locked = await this.cache.get<boolean>(`login_locked:${user.id}`);
    if (locked) {
      throw new HttpException(
        { error: 'LOGIN_LOCKED', message: 'Compte verrouillé, réessayez dans 30 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      const attemptsKey = `login_attempts:${user.id}`;
      const count = await this.cache.incr(attemptsKey, 1800);
      if (count >= 5) {
        await this.cache.set(`login_locked:${user.id}`, true, 1800);
        await this.cache.del(attemptsKey);
        this.emailQueue.sendEmail({
          to: user.email,
          subject: 'Votre compte Immo Plus CM a été verrouillé',
          template: 'account-locked',
          data: { name: user.firstName, unlockTime: '30 minutes' },
        }).catch(() => {});
        throw new HttpException(
          { error: 'LOGIN_LOCKED', message: 'Compte verrouillé, réessayez dans 30 minutes.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect.' });
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({ error: 'PENDING_VERIFICATION', message: 'Vérifiez votre email avant de vous connecter.' });
    }
    if (!user.isActive) {
      throw new ForbiddenException({ error: 'ACCOUNT_DISABLED', message: 'Votre compte a été désactivé.' });
    }

    await this.cache.del(`login_attempts:${user.id}`);
    await this.cache.del(`login_locked:${user.id}`);

    return this.generateAuthResponse(user.id, user.email, user.role);
  }

  async refresh(refreshToken: string) {
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException({ error: 'REFRESH_TOKEN_INVALID', message: 'Refresh token invalide ou révoqué.' });
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    const { user } = tokenRecord;
    return this.generateAuthResponse(user.id, user.email, user.role);
  }

  async logout(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Déconnecté avec succès.' };
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return { message: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' };
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } });

    await this.emailQueue.sendEmail({
      to: user.email,
      subject: 'Réinitialisation de votre mot de passe Immo Plus CM',
      template: 'password-reset',
      data: {
        name: user.firstName,
        resetUrl: `${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`,
      },
    });

    return { message: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.password_confirm) {
      throw new BadRequestException('Les mots de passe ne correspondent pas.');
    }

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
    });

    if (!tokenRecord || tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException('Token invalide ou expiré.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });

    return { message: 'Mot de passe réinitialisé avec succès.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.newPasswordConfirm) {
      throw new BadRequestException('Les nouveaux mots de passe ne correspondent pas.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    return { message: 'Mot de passe modifié avec succès.' };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  private async generateAuthResponse(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY', '1h') as any,
    });

    const rawRefreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, token: rawRefreshToken, expiresAt },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 3600,
      user,
    };
  }
}
