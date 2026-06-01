import { Role } from '@prisma/client';

/** Shape of the object attached to request.user by JwtStrategy.validate(). */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  isActive: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}
