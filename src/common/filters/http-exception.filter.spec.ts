import { ArgumentsHost, BadRequestException, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { url: '/api/users/profile/avatar' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('PayloadTooLargeException (multer LIMIT_FILE_SIZE, transformé par @nestjs/platform-express) → 400 FILE_TOO_LARGE au lieu du 413 brut', () => {
    const { host, status, json } = makeHost();
    const exception = new PayloadTooLargeException('File too large');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'FILE_TOO_LARGE',
      message: 'FILE_TOO_LARGE',
    }));
  });

  it('BadRequestException standard toujours gérée normalement', () => {
    const { host, status, json } = makeHost();
    const exception = new BadRequestException({ error: 'INVALID_FILE_TYPE', message: 'Type invalide' });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INVALID_FILE_TYPE', message: 'Type invalide' }));
  });

  it('exception inconnue → 500 générique inchangé', () => {
    const { host, status, json } = makeHost();
    const exception = new Error('boom');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'INTERNAL_SERVER_ERROR' }));
  });
});
