import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';

import { PrismaModule } from './prisma/prisma.module';
import { DatabaseModule } from './database/database.module';
import { RedisCacheModule } from './cache/cache.module';
import { StorageModule } from './storage/storage.module';
import { CronModule } from './queue/cron.module';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { TenantsModule } from './tenants/tenants.module';
import { ContractsModule } from './contracts/contracts.module';
import { PaymentsModule } from './payments/payments.module';
import { DocumentsModule } from './documents/documents.module';
import { MessagesModule } from './messages/messages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AdminModule } from './admin/admin.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 200 }]),

    PrismaModule,
    DatabaseModule,
    RedisCacheModule,
    StorageModule,
    CronModule,

    AuthModule,
    UsersModule,
    PropertiesModule,
    TenantsModule,
    ContractsModule,
    PaymentsModule,
    DocumentsModule,
    MessagesModule,
    NotificationsModule,
    DashboardModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
