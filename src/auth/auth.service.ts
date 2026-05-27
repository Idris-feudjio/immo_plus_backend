import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  async register(dto: RegisterDto) {
    if (dto.password !== dto.passwordConfirm) {
      throw new BadRequestException('Les mots de passe ne correspondent pas.');
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
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

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role as any,
      },
    });

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.otpCode.create({
      data: { userId: user.id, code: otp, expiresAt },
    });

    // TODO: send OTP via email and SMS
    console.log(`OTP for ${user.email}: ${otp}`);

    return {
      message: 'Compte créé. Vérifiez votre email pour activer votre compte.',
      userId: user.id,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        code: dto.otp,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new BadRequestException({ error: 'OTP_INVALID', message: 'Code OTP invalide ou expiré.' });
    }

    await this.prisma.otpCode.update({
      where: { id: otpRecord.id },
      data: { usedAt: new Date() },
    });

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
      throw new BadRequestException('Trop de tentatives. Réessayez dans 10 minutes.');
    }

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.otpCode.create({ data: { userId, code: otp, expiresAt } });
    console.log(`Resend OTP for ${user.email}: ${otp}`);

    return { message: 'OTP renvoyé avec succès.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email ou mot de passe incorrect.');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException({ error: 'EMAIL_NOT_VERIFIED', message: 'Email non vérifié.' });
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Compte désactivé.');
    }

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
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { message: 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.' };
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } });
    console.log(`Reset link: ${this.config.get('FRONTEND_URL')}/reset-password?token=${token}`);

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
    return Math.floor(100000 + Math.random() * 900000).toString();
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
