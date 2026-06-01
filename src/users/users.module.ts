import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRepository } from './user.repository';
import { USERS_SERVICE } from './interfaces/users-service.interface';

@Module({
  controllers: [UsersController],
  providers: [
    UserRepository,
    { provide: USERS_SERVICE, useClass: UsersService },
  ],
  exports: [USERS_SERVICE, UserRepository],
})
export class UsersModule {}
