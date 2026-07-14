import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'INTERNAL_SERVER_ERROR';
    let message = 'Une erreur interne est survenue.';
    let details: unknown[] | undefined;

    // @nestjs/platform-express's FileInterceptor already converts multer's raw
    // LIMIT_FILE_SIZE error into a PayloadTooLargeException before it reaches this
    // filter — remap it to match the FILE_TOO_LARGE shape our manual size checks use.
    if (exception instanceof PayloadTooLargeException) {
      statusCode = HttpStatus.BAD_REQUEST;
      error = 'FILE_TOO_LARGE';
      message = 'FILE_TOO_LARGE';
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, unknown>;
        error = (res.error as string) || exception.name;
        message = (res.message as string) || exception.message;
        if (Array.isArray(res.message)) {
          details = res.message as unknown[];
          message = 'Les données fournies sont invalides.';
          error = 'VALIDATION_ERROR';
        }
      } else {
        message = exceptionResponse as string;
      }
    }

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      ...(details ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
