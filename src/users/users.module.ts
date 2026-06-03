import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserRepository } from './user.repository';

@Module({
  controllers: [UsersController],
  providers: [UserRepository, UsersService],
  exports: [UsersService, UserRepository],
})
export class UsersModule {}
