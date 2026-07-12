import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto, ChangePasswordDto } from './dto/reset-password.dto';
import { SetRoleDto } from './dto/set-role.dto.js';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import type { GoogleUser } from './strategies/google.strategy.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Inscription (OWNER ou TENANT uniquement)' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification email par OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renvoyer OTP' })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.userId);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    const userAgent = (req.headers['user-agent'] as string) ?? 'unknown';
    return this.auth.login(dto, { ip, userAgent });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rafraîchir le token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion' })
  logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshTokenDto) {
    return this.auth.logout(user.id, dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mot de passe oublié' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialiser le mot de passe' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changer le mot de passe' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initier la connexion Google OAuth' })
  googleLogin() {
    // Passport intercepte et gère le redirect — ce handler n'est pas atteint
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Callback Google OAuth' })
  async googleCallback(
    @Req() req: Request & { user?: GoogleUser },
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');
    // P08: guard-level failures (OAuth cancel, missing email) set req.user to null
    if (!req.user) {
      return res.redirect(`${frontendUrl}/auth/google/callback?${new URLSearchParams({ error: 'OAUTH_FAILED' }).toString()}`);
    }
    try {
      const result = await this.auth.googleAuth(req.user);
      // P01: access token removed from URL — frontend uses refresh token to get full user object
      const params = new URLSearchParams({ refresh: result.refreshToken });
      if (result.newUser) params.set('newUser', 'true');
      return res.redirect(`${frontendUrl}/auth/google/callback?${params.toString()}`);
    } catch (err: unknown) {
      // P06: use URLSearchParams for safe encoding
      const code = (err as { response?: { error?: string } })?.response?.error ?? 'OAUTH_FAILED';
      return res.redirect(`${frontendUrl}/auth/google/callback?${new URLSearchParams({ error: code }).toString()}`);
    }
  }

  @Patch('me/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Définir le rôle après connexion Google (VISITOR → OWNER|TENANT)' })
  setRole(@CurrentUser() user: AuthUser, @Body() dto: SetRoleDto) {
    return this.auth.setGoogleRole(user.id, dto.role as 'OWNER' | 'TENANT');
  }
}
