import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  env: process.env.NODE_ENV ?? 'development',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.REFRESH_SECRET ?? '',
  refreshExpiresIn: process.env.REFRESH_EXPIRES_IN ?? '7d',
}));
