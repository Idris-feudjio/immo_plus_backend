import { BadRequestException } from '@nestjs/common';
import { FileValidationPipe } from './file-validation.pipe';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MAX = 5 * 1024 * 1024;
const DOC_TYPES = ['application/pdf'];
const DOC_MAX = 10 * 1024 * 1024;

function makeFile(mimetype: string, size: number): Express.Multer.File {
  return {
    mimetype,
    size,
    buffer: Buffer.alloc(size),
    originalname: 'file',
    fieldname: 'file',
    encoding: '7bit',
    stream: null as never,
    destination: '',
    filename: '',
    path: '',
  };
}

describe('FileValidationPipe', () => {
  describe('image preset', () => {
    const pipe = new FileValidationPipe(IMAGE_TYPES, IMAGE_MAX);

    it('passes a valid JPEG file through unchanged', () => {
      const file = makeFile('image/jpeg', 3 * 1024 * 1024);

      expect(pipe.transform(file)).toBe(file);
    });

    it('rejects a disallowed MIME type with INVALID_FILE_TYPE', () => {
      const file = makeFile('text/plain', 100);

      expect(() => pipe.transform(file)).toThrow(BadRequestException);
      expect(() => pipe.transform(file)).toThrow('INVALID_FILE_TYPE');
    });

    it('rejects a file over the size limit with FILE_TOO_LARGE', () => {
      const file = makeFile('image/jpeg', IMAGE_MAX + 1);

      expect(() => pipe.transform(file)).toThrow(BadRequestException);
      expect(() => pipe.transform(file)).toThrow('FILE_TOO_LARGE');
    });

    it('accepts a file exactly at the size boundary', () => {
      const file = makeFile('image/jpeg', IMAGE_MAX);

      expect(pipe.transform(file)).toBe(file);
    });
  });

  describe('document preset', () => {
    const pipe = new FileValidationPipe(DOC_TYPES, DOC_MAX);

    it('passes a valid PDF file through unchanged', () => {
      const file = makeFile('application/pdf', 8 * 1024 * 1024);

      expect(pipe.transform(file)).toBe(file);
    });

    it('rejects a disallowed MIME type with INVALID_FILE_TYPE', () => {
      const file = makeFile('application/msword', 100);

      expect(() => pipe.transform(file)).toThrow('INVALID_FILE_TYPE');
    });

    it('rejects a file over the 10 MB limit with FILE_TOO_LARGE', () => {
      const file = makeFile('application/pdf', 12 * 1024 * 1024);

      expect(() => pipe.transform(file)).toThrow('FILE_TOO_LARGE');
    });

    it('accepts a file exactly at the size boundary', () => {
      const file = makeFile('application/pdf', DOC_MAX);

      expect(pipe.transform(file)).toBe(file);
    });
  });

  describe('array input (from @UploadedFiles())', () => {
    const pipe = new FileValidationPipe(IMAGE_TYPES, IMAGE_MAX);

    it('passes an array of valid files through unchanged', () => {
      const files = [makeFile('image/jpeg', 100), makeFile('image/png', 200)];

      expect(pipe.transform(files)).toBe(files);
    });

    it('rejects the whole array if one file among valid ones is the wrong type', () => {
      const files = [
        makeFile('image/jpeg', 100),
        makeFile('text/plain', 100),
        makeFile('image/png', 100),
      ];

      expect(() => pipe.transform(files)).toThrow('INVALID_FILE_TYPE');
    });

    it('rejects the whole array if one file among valid ones is too large', () => {
      const files = [
        makeFile('image/jpeg', 100),
        makeFile('image/png', IMAGE_MAX + 1),
      ];

      expect(() => pipe.transform(files)).toThrow('FILE_TOO_LARGE');
    });
  });

  describe('empty/undefined input', () => {
    const pipe = new FileValidationPipe(IMAGE_TYPES, IMAGE_MAX);

    it('passes undefined through without throwing', () => {
      expect(pipe.transform(undefined as never)).toBeUndefined();
    });

    it('passes an empty array through without throwing', () => {
      const files: Express.Multer.File[] = [];

      expect(pipe.transform(files)).toBe(files);
    });
  });
});
