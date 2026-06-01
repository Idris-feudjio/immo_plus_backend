import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface TransformResponse<T> {
  data: T;
  statusCode: number;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, TransformResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<TransformResponse<T>> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data) => ({
        data,
        statusCode: res.statusCode,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
