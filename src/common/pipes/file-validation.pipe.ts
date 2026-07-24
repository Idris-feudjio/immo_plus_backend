import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Rejects files with a disallowed MIME type or over the size limit before any
 * StorageService call. Throws BadRequestException (400), not
 * UnsupportedMediaTypeException/PayloadTooLargeException — GlobalExceptionFilter
 * already remaps 413 down to 400/FILE_TOO_LARGE, and every existing inline
 * validation in this codebase uses 400 + INVALID_FILE_TYPE/FILE_TOO_LARGE.
 */
@Injectable()
export class FileValidationPipe implements PipeTransform<
  Express.Multer.File | Express.Multer.File[] | undefined,
  Express.Multer.File | Express.Multer.File[] | undefined
> {
  constructor(
    private readonly allowedMimeTypes: string[],
    private readonly maxSizeBytes: number,
  ) {}

  transform(
    value: Express.Multer.File | Express.Multer.File[] | undefined,
  ): Express.Multer.File | Express.Multer.File[] | undefined {
    if (!value) return value;

    const files = Array.isArray(value) ? value : [value];
    for (const file of files) {
      if (!this.allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException('INVALID_FILE_TYPE');
      }
      if (file.buffer.length > this.maxSizeBytes) {
        throw new BadRequestException('FILE_TOO_LARGE');
      }
    }

    return value;
  }
}
