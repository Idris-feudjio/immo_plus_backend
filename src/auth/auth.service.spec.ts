import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from '../notifications/email-queue.service.js';
import { CacheService } from '../cache/cache.service';

const mockBcryptCompare = jest.fn();
jest.mock('bcrypt', () => ({
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: jest.fn().mockResolvedValue('hashed'),
}));

const BASE_USER = {
  id: 'uid-1',
  email: 'user@test.com',
  firstName: 'Alice',
  passwordHash: '$2b$12$hashed',
  emailVerified: true,
  isActive: true,
  role: 'OWNER' as const,
};

describe('AuthService — login()', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock };
  let prismaRefresh: { create: jest.Mock };
  let prismaAudit: { create: jest.Mock };
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    incr: jest.Mock;
  };
  let emailQueue: { sendEmail: jest.Mock };

  beforeEach(async () => {
    mockBcryptCompare.mockReset();

    prismaUser = { findUnique: jest.fn() };
    prismaRefresh = { create: jest.fn().mockResolvedValue({}) };
    prismaAudit = { create: jest.fn().mockResolvedValue({}) };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn().mockResolvedValue(1),
    };
    emailQueue = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: prismaUser,
            refreshToken: prismaRefresh,
            adminAuditLog: prismaAudit,
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
        { provide: EmailQueueService, useValue: emailQueue },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('AC#2 — email inconnu → 401 INVALID_CREDENTIALS', async () => {
    prismaUser.findUnique.mockResolvedValue(null);

    const err = await service
      .login({ email: 'no@one.com', password: 'x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.response).toMatchObject({ error: 'INVALID_CREDENTIALS' });
  });

  it('AC#7 — compte verrouillé → 429 LOGIN_LOCKED sans vérifier le mdp', async () => {
    prismaUser.findUnique.mockResolvedValue(BASE_USER);
    cache.get.mockResolvedValue(true);

    const err = await service
      .login({ email: BASE_USER.email, password: 'any' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ error: 'LOGIN_LOCKED' });
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  it('AC#2 — mot de passe incorrect → 401 INVALID_CREDENTIALS + incr compteur', async () => {
    prismaUser.findUnique.mockResolvedValue(BASE_USER);
    mockBcryptCompare.mockResolvedValue(false);
    cache.incr.mockResolvedValue(2);

    const err = await service
      .login({ email: BASE_USER.email, password: 'wrong' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.response).toMatchObject({ error: 'INVALID_CREDENTIALS' });
    expect(cache.incr).toHaveBeenCalledWith(
      `login_attempts:${BASE_USER.id}`,
      1800,
    );
  });

  it('AC#3 — 5ème échec → verrouillage + email notification + 429', async () => {
    prismaUser.findUnique.mockResolvedValue(BASE_USER);
    mockBcryptCompare.mockResolvedValue(false);
    cache.incr.mockResolvedValue(5);

    const err = await service
      .login({ email: BASE_USER.email, password: 'wrong' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(cache.set).toHaveBeenCalledWith(
      `login_locked:${BASE_USER.id}`,
      true,
      1800,
    );
    expect(cache.del).toHaveBeenCalledWith(`login_attempts:${BASE_USER.id}`);
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'account-locked',
        to: BASE_USER.email,
      }),
    );
  });

  it('AC#5 — email non vérifié → 403 PENDING_VERIFICATION', async () => {
    prismaUser.findUnique.mockResolvedValue({
      ...BASE_USER,
      emailVerified: false,
    });
    mockBcryptCompare.mockResolvedValue(true);

    const err = await service
      .login({ email: BASE_USER.email, password: 'correct' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({ error: 'PENDING_VERIFICATION' });
  });

  it('AC#6 — compte désactivé → 403 ACCOUNT_DISABLED', async () => {
    prismaUser.findUnique.mockResolvedValue({ ...BASE_USER, isActive: false });
    mockBcryptCompare.mockResolvedValue(true);

    const err = await service
      .login({ email: BASE_USER.email, password: 'correct' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({ error: 'ACCOUNT_DISABLED' });
  });

  it('AC#1 — connexion réussie → vide les compteurs Redis + retourne accessToken', async () => {
    const fullUser = {
      ...BASE_USER,
      lastName: 'User',
      phone: null,
      avatarUrl: null,
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(BASE_USER)
      .mockResolvedValueOnce(fullUser);
    mockBcryptCompare.mockResolvedValue(true);

    const result = await service.login({
      email: BASE_USER.email,
      password: 'correct',
    });

    expect(cache.del).toHaveBeenCalledWith(`login_attempts:${BASE_USER.id}`);
    expect(cache.del).toHaveBeenCalledWith(`login_locked:${BASE_USER.id}`);
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  it('AC#5 — admin login avec contexte → écrit un audit log USER_LOGIN', async () => {
    const adminUser = { ...BASE_USER, role: 'ADMIN' as const };
    const fullUser = {
      ...adminUser,
      lastName: 'User',
      phone: null,
      avatarUrl: null,
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(adminUser)
      .mockResolvedValueOnce(fullUser);
    mockBcryptCompare.mockResolvedValue(true);

    await service.login(
      { email: adminUser.email, password: 'correct' },
      { ip: '1.2.3.4', userAgent: 'jest-agent' },
    );

    expect(prismaAudit.create).toHaveBeenCalledWith({
      data: {
        adminId: adminUser.id,
        action: 'USER_LOGIN',
        ip: '1.2.3.4',
        userAgent: 'jest-agent',
        result: 'SUCCESS',
      },
    });
  });

  it('AC#5 — login non-admin → aucun audit log écrit', async () => {
    const fullUser = {
      ...BASE_USER,
      lastName: 'User',
      phone: null,
      avatarUrl: null,
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(BASE_USER)
      .mockResolvedValueOnce(fullUser);
    mockBcryptCompare.mockResolvedValue(true);

    await service.login(
      { email: BASE_USER.email, password: 'correct' },
      { ip: '1.2.3.4', userAgent: 'jest-agent' },
    );

    expect(prismaAudit.create).not.toHaveBeenCalled();
  });
});

// ─── verifyEmail() ────────────────────────────────────────────────────────────

const VALID_OTP = {
  id: 'otp-1',
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
};
const EXPIRED_OTP = {
  id: 'otp-1',
  expiresAt: new Date(Date.now() - 5 * 60 * 1000),
};
const UNVERIFIED_USER = { ...BASE_USER, emailVerified: false };

describe('AuthService — verifyEmail()', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock; update: jest.Mock };
  let prismaOtpCode: {
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  let prismaRefresh: { create: jest.Mock };
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    incr: jest.Mock;
  };

  beforeEach(async () => {
    prismaUser = {
      findUnique: jest.fn().mockResolvedValue(UNVERIFIED_USER),
      update: jest.fn().mockResolvedValue({}),
    };
    prismaOtpCode = {
      findFirst: jest.fn().mockResolvedValue(VALID_OTP),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    prismaRefresh = { create: jest.fn().mockResolvedValue({}) };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn().mockResolvedValue(1),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: prismaUser,
            otpCode: prismaOtpCode,
            refreshToken: prismaRefresh,
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
        {
          provide: EmailQueueService,
          useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('guard emailVerified — compte déjà vérifié → retourne message sans vérifier le code OTP', async () => {
    prismaUser.findUnique.mockResolvedValue(BASE_USER); // emailVerified: true

    const result = await service.verifyEmail({
      userId: BASE_USER.id,
      otp: '123456',
    });

    expect(result).toMatchObject({ message: 'Email déjà vérifié.' });
    expect(prismaOtpCode.findFirst).not.toHaveBeenCalled();
  });

  it('AC#4 — précheck Redis ≥ 3 → 400 OTP_MAX_ATTEMPTS sans requête OTP', async () => {
    cache.get.mockResolvedValue(3);

    const err = await service
      .verifyEmail({ userId: BASE_USER.id, otp: '123456' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ error: 'OTP_MAX_ATTEMPTS' });
    expect(prismaOtpCode.findFirst).not.toHaveBeenCalled();
  });

  it('AC#2 — code incorrect (OTP non trouvé) → 400 OTP_INVALID + incr compteur Redis', async () => {
    prismaOtpCode.findFirst.mockResolvedValue(null);
    cache.incr.mockResolvedValue(1);

    const err = await service
      .verifyEmail({ userId: BASE_USER.id, otp: '000000' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ error: 'OTP_INVALID' });
    expect(cache.incr).toHaveBeenCalledWith(
      `otp_attempts:${BASE_USER.id}`,
      600,
    );
  });

  it('AC#4 — 3ème échec → invalidation des OTPs actifs + 400 OTP_MAX_ATTEMPTS', async () => {
    prismaOtpCode.findFirst.mockResolvedValue(null);
    cache.incr.mockResolvedValue(3);

    const err = await service
      .verifyEmail({ userId: BASE_USER.id, otp: '000000' })
      .catch((e) => e);

    expect(err.response).toMatchObject({ error: 'OTP_MAX_ATTEMPTS' });
    expect(prismaOtpCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: BASE_USER.id, usedAt: null },
        data: { usedAt: expect.any(Date) },
      }),
    );
  });

  it('AC#3 — code correct mais expiré → 400 OTP_EXPIRED (sans incr compteur)', async () => {
    prismaOtpCode.findFirst.mockResolvedValue(EXPIRED_OTP);

    const err = await service
      .verifyEmail({ userId: BASE_USER.id, otp: '123456' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ error: 'OTP_EXPIRED' });
    expect(cache.incr).not.toHaveBeenCalled();
  });

  it('guard isActive — compte désactivé → 403 ACCOUNT_DISABLED même avec code correct', async () => {
    prismaUser.findUnique.mockResolvedValue({
      ...UNVERIFIED_USER,
      isActive: false,
    });

    const err = await service
      .verifyEmail({ userId: BASE_USER.id, otp: '123456' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({ error: 'ACCOUNT_DISABLED' });
  });

  it('AC#1 — code correct et valide → reset compteur, marque OTP usedAt, emailVerified=true, tokens', async () => {
    const fullUser = {
      ...BASE_USER,
      lastName: 'User',
      phone: null,
      avatarUrl: null,
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(UNVERIFIED_USER)
      .mockResolvedValueOnce(fullUser);

    const result = await service.verifyEmail({
      userId: BASE_USER.id,
      otp: '123456',
    });

    expect(cache.del).toHaveBeenCalledWith(`otp_attempts:${BASE_USER.id}`);
    expect(prismaOtpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: VALID_OTP.id },
        data: { usedAt: expect.any(Date) },
      }),
    );
    expect(prismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BASE_USER.id },
        data: { emailVerified: true },
      }),
    );
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });
});

// ─── resendOtp() ──────────────────────────────────────────────────────────────

describe('AuthService — resendOtp()', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock };
  let prismaOtpCode: {
    count: jest.Mock;
    updateMany: jest.Mock;
    create: jest.Mock;
  };
  let cache: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    incr: jest.Mock;
  };
  let emailQueue: { sendEmail: jest.Mock };

  beforeEach(async () => {
    prismaUser = { findUnique: jest.fn().mockResolvedValue(BASE_USER) };
    prismaOtpCode = {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      incr: jest.fn().mockResolvedValue(0),
    };
    emailQueue = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: prismaUser, otpCode: prismaOtpCode },
        },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailQueueService, useValue: emailQueue },
        { provide: CacheService, useValue: cache },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('utilisateur inconnu → 404 NotFoundException', async () => {
    prismaUser.findUnique.mockResolvedValue(null);

    const err = await service.resendOtp('unknown-id').catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundException);
  });

  it('rate limit — 3 OTPs récents → 400 OTP_RESEND_LIMIT sans créer de nouveau code', async () => {
    prismaOtpCode.count.mockResolvedValue(3);

    const err = await service.resendOtp(BASE_USER.id).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ error: 'OTP_RESEND_LIMIT' });
    expect(prismaOtpCode.create).not.toHaveBeenCalled();
  });

  it('succès — invalide anciens OTPs + clear otp_attempts + crée nouveau OTP + envoie email', async () => {
    await service.resendOtp(BASE_USER.id);

    expect(prismaOtpCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: BASE_USER.id, usedAt: null },
        data: { usedAt: expect.any(Date) },
      }),
    );
    expect(cache.del).toHaveBeenCalledWith(`otp_attempts:${BASE_USER.id}`);
    expect(prismaOtpCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: BASE_USER.id }),
      }),
    );
    expect(emailQueue.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: BASE_USER.email, template: 'otp' }),
    );
  });
});

// ─── googleAuth() ─────────────────────────────────────────────────────────────

const GOOGLE_USER_INPUT = {
  email: 'alice@gmail.com',
  firstName: 'Alice',
  lastName: 'Dupont',
  googleId: 'gid-123456',
};

const FULL_USER_FIXTURE = {
  id: 'uid-2',
  email: 'alice@gmail.com',
  firstName: 'Alice',
  lastName: 'Dupont',
  phone: null,
  role: 'OWNER' as const,
  avatarUrl: null,
};

describe('AuthService — googleAuth()', () => {
  let service: AuthService;
  let prismaUser: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let prismaRefresh: { create: jest.Mock };

  beforeEach(async () => {
    prismaUser = {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };
    prismaRefresh = { create: jest.fn().mockResolvedValue({}) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: prismaUser, refreshToken: prismaRefresh },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
        {
          provide: EmailQueueService,
          useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('AC#1 — nouveau compte → create avec role=VISITOR + emailVerified=true + passwordHash=null, retourne newUser=true', async () => {
    prismaUser.findUnique
      .mockResolvedValueOnce(null) // email lookup → pas de compte
      .mockResolvedValueOnce(FULL_USER_FIXTURE); // generateAuthResponse user select
    prismaUser.create.mockResolvedValue({
      id: 'uid-2',
      email: 'alice@gmail.com',
      role: 'VISITOR',
    });

    const result = await service.googleAuth(GOOGLE_USER_INPUT);

    expect(prismaUser.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'VISITOR',
          emailVerified: true,
          passwordHash: null,
          googleId: GOOGLE_USER_INPUT.googleId,
        }),
      }),
    );
    expect(result.newUser).toBe(true);
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  it('AC#2 — compte existant sans googleId → update pour lier googleId, retourne newUser=false', async () => {
    const existingUser = {
      id: 'uid-1',
      email: 'alice@gmail.com',
      isActive: true,
      googleId: null,
      role: 'OWNER',
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(existingUser) // email lookup → compte trouvé sans googleId
      .mockResolvedValueOnce(FULL_USER_FIXTURE); // generateAuthResponse user select

    const result = await service.googleAuth(GOOGLE_USER_INPUT);

    expect(prismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: existingUser.id },
        data: { googleId: GOOGLE_USER_INPUT.googleId },
      }),
    );
    expect(result.newUser).toBe(false);
    expect(result).toHaveProperty('accessToken');
  });

  it('AC#3 — compte existant avec googleId déjà lié → pas de update, retourne tokens normalement', async () => {
    const existingUser = {
      id: 'uid-1',
      email: 'alice@gmail.com',
      isActive: true,
      googleId: 'gid-123456',
      role: 'OWNER',
    };
    prismaUser.findUnique
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(FULL_USER_FIXTURE);

    const result = await service.googleAuth(GOOGLE_USER_INPUT);

    expect(prismaUser.update).not.toHaveBeenCalled();
    expect(result.newUser).toBe(false);
    expect(result).toHaveProperty('accessToken');
  });

  it('AC#5 — compte isActive=false → ForbiddenException ACCOUNT_DISABLED', async () => {
    prismaUser.findUnique.mockResolvedValueOnce({
      id: 'uid-1',
      email: 'alice@gmail.com',
      isActive: false,
      googleId: null,
      role: 'OWNER',
    });

    const err = await service.googleAuth(GOOGLE_USER_INPUT).catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.response).toMatchObject({ error: 'ACCOUNT_DISABLED' });
    expect(prismaUser.update).not.toHaveBeenCalled();
  });
});

// ─── changePassword() ─────────────────────────────────────────────────────────

describe('AuthService — changePassword()', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock; update: jest.Mock };
  let prismaRefresh: { updateMany: jest.Mock };

  const USER_WITH_HASH = {
    id: 'uid-1',
    email: 'user@test.com',
    passwordHash: '$2b$12$hashed',
    isActive: true,
    role: 'OWNER' as const,
  };

  beforeEach(async () => {
    mockBcryptCompare.mockReset();
    prismaUser = {
      findUnique: jest.fn().mockResolvedValue(USER_WITH_HASH),
      update: jest.fn().mockResolvedValue({}),
    };
    prismaRefresh = { updateMany: jest.fn().mockResolvedValue({ count: 2 }) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: prismaUser, refreshToken: prismaRefresh },
        },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailQueueService, useValue: { sendEmail: jest.fn() } },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('succès — met à jour le hash et révoque tous les refresh tokens actifs', async () => {
    mockBcryptCompare.mockResolvedValue(true);
    const dto = {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass1',
      newPasswordConfirm: 'NewPass1',
    };

    const result = await service.changePassword(USER_WITH_HASH.id, dto);

    expect(prismaUser.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_WITH_HASH.id },
        data: { passwordHash: 'hashed' },
      }),
    );
    expect(prismaRefresh.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_WITH_HASH.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toHaveProperty('message');
  });

  it('mot de passe actuel incorrect → UnauthorizedException', async () => {
    mockBcryptCompare.mockResolvedValue(false);
    const dto = {
      currentPassword: 'wrong',
      newPassword: 'NewPass1',
      newPasswordConfirm: 'NewPass1',
    };

    const err = await service
      .changePassword(USER_WITH_HASH.id, dto)
      .catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(prismaRefresh.updateMany).not.toHaveBeenCalled();
  });

  it('compte Google-only (passwordHash=null) → BadRequestException NO_PASSWORD', async () => {
    prismaUser.findUnique.mockResolvedValue({
      ...USER_WITH_HASH,
      passwordHash: null,
    });
    const dto = {
      currentPassword: 'any',
      newPassword: 'NewPass1',
      newPasswordConfirm: 'NewPass1',
    };

    const err = await service
      .changePassword(USER_WITH_HASH.id, dto)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.response).toMatchObject({ error: 'NO_PASSWORD' });
    expect(prismaRefresh.updateMany).not.toHaveBeenCalled();
  });

  it('confirmation ne correspond pas → BadRequestException', async () => {
    const dto = {
      currentPassword: 'OldPass1',
      newPassword: 'NewPass1',
      newPasswordConfirm: 'Different',
    };

    const err = await service
      .changePassword(USER_WITH_HASH.id, dto)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(prismaUser.findUnique).not.toHaveBeenCalled();
  });
});

// ─── logout() ─────────────────────────────────────────────────────────────────

describe('AuthService — logout()', () => {
  let service: AuthService;
  let prismaRefresh: { updateMany: jest.Mock };

  beforeEach(async () => {
    prismaRefresh = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: { refreshToken: prismaRefresh } },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailQueueService, useValue: { sendEmail: jest.fn() } },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it("AC#1 — révoque le refresh token courant de l'utilisateur", async () => {
    const result = await service.logout('uid-1', 'refresh-token-abc');

    expect(prismaRefresh.updateMany).toHaveBeenCalledWith({
      where: { userId: 'uid-1', token: 'refresh-token-abc', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(result).toHaveProperty('message');
  });
});

// ─── refresh() ────────────────────────────────────────────────────────────────

describe('AuthService — refresh()', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock };
  let prismaRefresh: {
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };

  const TOKEN_RECORD = {
    id: 'rt-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    user: { id: 'uid-1', email: 'user@test.com', role: 'OWNER' as const },
  };

  beforeEach(async () => {
    prismaUser = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'uid-1',
        email: 'user@test.com',
        role: 'OWNER',
      }),
    };
    prismaRefresh = {
      findUnique: jest.fn().mockResolvedValue(TOKEN_RECORD),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: prismaUser, refreshToken: prismaRefresh },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
        { provide: EmailQueueService, useValue: { sendEmail: jest.fn() } },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('AC#2 — token introuvable → 401 REFRESH_TOKEN_INVALID', async () => {
    prismaRefresh.findUnique.mockResolvedValue(null);

    const err = await service.refresh('unknown-token').catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.response).toMatchObject({ error: 'REFRESH_TOKEN_INVALID' });
  });

  it('AC#2 — token révoqué → 401 REFRESH_TOKEN_INVALID', async () => {
    prismaRefresh.findUnique.mockResolvedValue({
      ...TOKEN_RECORD,
      revokedAt: new Date(),
    });

    const err = await service.refresh('revoked-token').catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.response).toMatchObject({ error: 'REFRESH_TOKEN_INVALID' });
  });

  it('AC#2 — token expiré → 401 REFRESH_TOKEN_INVALID', async () => {
    prismaRefresh.findUnique.mockResolvedValue({
      ...TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    const err = await service.refresh('expired-token').catch((e) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.response).toMatchObject({ error: 'REFRESH_TOKEN_INVALID' });
  });

  it("succès — révoque l'ancien token et retourne un nouveau access/refresh token (rotation, NFR-S1)", async () => {
    const result = await service.refresh('valid-token');

    expect(prismaRefresh.update).toHaveBeenCalledWith({
      where: { id: TOKEN_RECORD.id },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prismaRefresh.create).toHaveBeenCalled();
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });
});

describe('AuthService — register() — free trial activation', () => {
  let service: AuthService;
  let prismaUser: { findUnique: jest.Mock; create: jest.Mock };
  let prismaOtp: { create: jest.Mock };
  let prismaPlan: { findUnique: jest.Mock };
  let prismaSubscription: { create: jest.Mock };
  let prismaTrial: { create: jest.Mock };
  let emailQueue: { sendEmail: jest.Mock };

  const REGISTER_DTO_BASE = {
    firstName: 'Alice',
    lastName: 'Ngo',
    email: 'alice@test.com',
    password: 'Password1',
    passwordConfirm: 'Password1',
  };

  beforeEach(async () => {
    prismaUser = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'new-user-1',
        firstName: 'Alice',
        email: 'alice@test.com',
      }),
    };
    prismaOtp = { create: jest.fn().mockResolvedValue({}) };
    prismaPlan = {
      findUnique: jest.fn().mockResolvedValue({ id: 'plan-pro' }),
    };
    prismaSubscription = {
      create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    };
    prismaTrial = { create: jest.fn().mockResolvedValue({}) };
    emailQueue = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: prismaUser,
            otpCode: prismaOtp,
            plan: prismaPlan,
            subscription: prismaSubscription,
            trial: prismaTrial,
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('1h') },
        },
        { provide: EmailQueueService, useValue: emailQueue },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
            incr: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('creates a TRIAL Subscription + Trial (14 days) for a new OWNER registration', async () => {
    await service.register({ ...REGISTER_DTO_BASE, role: 'OWNER' });

    expect(prismaPlan.findUnique).toHaveBeenCalledWith({
      where: { name: 'PROFESSIONAL' },
    });
    expect(prismaSubscription.create).toHaveBeenCalledWith({
      data: { ownerId: 'new-user-1', planId: 'plan-pro', status: 'TRIAL' },
    });
    expect(prismaTrial.create).toHaveBeenCalledWith({
      data: { subscriptionId: 'sub-1', endsAt: expect.any(Date) },
    });
  });

  it('does not create a Subscription for a new TENANT registration', async () => {
    await service.register({ ...REGISTER_DTO_BASE, role: 'TENANT' });

    expect(prismaSubscription.create).not.toHaveBeenCalled();
    expect(prismaTrial.create).not.toHaveBeenCalled();
  });

  it('does not fail registration when the Professional plan is missing (fail-open)', async () => {
    prismaPlan.findUnique.mockResolvedValue(null);

    const result = await service.register({
      ...REGISTER_DTO_BASE,
      role: 'OWNER',
    });

    expect(result).toHaveProperty('userId', 'new-user-1');
    expect(prismaSubscription.create).not.toHaveBeenCalled();
  });
});
