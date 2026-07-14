import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StorageService } from '../storage/storage.service';

const MOCK_USER = { id: 'uid-1', role: 'OWNER' as const, email: 'u@test.com' };

const makeFile = (mimetype: string, size = 100): Express.Multer.File => ({
  buffer:       Buffer.alloc(size),
  mimetype,
  fieldname:    'file',
  originalname: 'avatar.jpg',
  encoding:     '7bit',
  size,
  stream:       null as any,
  destination:  '',
  filename:     '',
  path:         '',
});

describe('UsersController — uploadAvatar()', () => {
  let controller: UsersController;
  let usersService: { findByIdOrThrow: jest.Mock; updateAvatar: jest.Mock };
  let storageService: { uploadBuffer: jest.Mock; delete: jest.Mock; keyFromUrl: jest.Mock };

  beforeEach(async () => {
    usersService = {
      findByIdOrThrow: jest.fn().mockResolvedValue({ ...MOCK_USER, avatarUrl: null }),
      updateAvatar: jest.fn().mockResolvedValue({ id: 'uid-1', avatarUrl: 'https://r2/users/uid-1/avatar.jpg' }),
    };
    storageService = {
      uploadBuffer: jest.fn().mockResolvedValue('https://r2/users/uid-1/avatar.jpg'),
      delete: jest.fn().mockResolvedValue(undefined),
      keyFromUrl: jest.fn().mockReturnValue('users/uid-1/avatar.jpg'),
    };

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    controller = module.get(UsersController);
  });

  it('type non autorisé (image/gif) → BadRequestException INVALID_FILE_TYPE', async () => {
    const err = await controller.uploadAvatar(MOCK_USER as any, makeFile('image/gif')).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('INVALID_FILE_TYPE');
    expect(storageService.uploadBuffer).not.toHaveBeenCalled();
  });

  it('fichier > 2 Mo → BadRequestException FILE_TOO_LARGE', async () => {
    const oversize = 2 * 1024 * 1024 + 1;
    const err = await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', oversize)).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain('FILE_TOO_LARGE');
    expect(storageService.uploadBuffer).not.toHaveBeenCalled();
  });

  it('image/jpeg valide → clé R2 = users/{id}/avatar.jpg, uploadBuffer appelé', async () => {
    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', 500));
    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      `users/${MOCK_USER.id}/avatar.jpg`,
      expect.any(Buffer),
      'image/jpeg',
    );
  });

  it('image/png valide → clé R2 = users/{id}/avatar.png', async () => {
    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/png', 500));
    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      `users/${MOCK_USER.id}/avatar.png`,
      expect.any(Buffer),
      'image/png',
    );
  });

  it('image/webp valide → clé R2 = users/{id}/avatar.webp', async () => {
    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/webp', 500));
    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      `users/${MOCK_USER.id}/avatar.webp`,
      expect.any(Buffer),
      'image/webp',
    );
  });

  it('ancien avatar avec extension différente → delete appelé avec la bonne clé après upload réussi', async () => {
    const oldUrl = 'https://r2/users/uid-1/avatar.png';
    usersService.findByIdOrThrow.mockResolvedValue({ ...MOCK_USER, avatarUrl: oldUrl });
    storageService.keyFromUrl.mockReturnValue('users/uid-1/avatar.png');

    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', 500));

    expect(storageService.keyFromUrl).toHaveBeenCalledWith(oldUrl);
    expect(storageService.delete).toHaveBeenCalledWith('users/uid-1/avatar.png');
    // Upload must complete before the old avatar is deleted — no data loss if upload fails
    expect(storageService.uploadBuffer.mock.invocationCallOrder[0])
      .toBeLessThan(storageService.delete.mock.invocationCallOrder[0]);
  });

  it('ancien et nouvel avatar ont la même clé (même extension) → delete NON appelé (évite l\'auto-suppression du fichier qui vient d\'être uploadé)', async () => {
    const oldUrl = 'https://r2/users/uid-1/avatar.jpg';
    usersService.findByIdOrThrow.mockResolvedValue({ ...MOCK_USER, avatarUrl: oldUrl });
    storageService.keyFromUrl.mockReturnValue('users/uid-1/avatar.jpg');

    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', 500));

    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      'users/uid-1/avatar.jpg',
      expect.any(Buffer),
      'image/jpeg',
    );
    expect(storageService.delete).not.toHaveBeenCalled();
  });

  it('upload échoue → ancien avatar NON supprimé (pas de perte de données)', async () => {
    const oldUrl = 'https://r2/users/uid-1/avatar.jpg';
    usersService.findByIdOrThrow.mockResolvedValue({ ...MOCK_USER, avatarUrl: oldUrl });
    storageService.uploadBuffer.mockRejectedValue(new Error('R2 unavailable'));

    const err = await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', 500)).catch(e => e);

    expect(err).toBeInstanceOf(Error);
    expect(storageService.delete).not.toHaveBeenCalled();
  });

  it('pas d\'ancien avatar → delete non appelé', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({ ...MOCK_USER, avatarUrl: null });

    await controller.uploadAvatar(MOCK_USER as any, makeFile('image/jpeg', 500));

    expect(storageService.delete).not.toHaveBeenCalled();
  });

  it('pas de fichier → BadRequestException MISSING_FILE', async () => {
    const err = await controller.uploadAvatar(MOCK_USER as any, null as any).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });
});
