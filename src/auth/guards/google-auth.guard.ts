import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  override handleRequest<TUser>(err: Error | null, user: TUser | false): TUser {
    // Return null instead of throwing — controller checks req.user and redirects
    return (err || !user ? null : user) as TUser;
  }
}
