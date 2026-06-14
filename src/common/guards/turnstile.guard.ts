import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TurnstileGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      body: Record<string, unknown>;
      ip: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const token = request.body['turnstileToken'] as string | undefined;

    if (!token) {
      throw new UnprocessableEntityException('TURNSTILE_TOKEN_MISSING');
    }

    const secret = this.config.get<string>('TURNSTILE_SECRET_KEY');
    const rawIp =
      request.headers['cf-connecting-ip'] ??
      request.headers['x-forwarded-for'] ??
      request.ip;
    const remoteip = Array.isArray(rawIp) ? rawIp[0] : rawIp;

    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token, remoteip }),
      },
    );

    const data = (await response.json()) as { success: boolean };

    if (!data.success) {
      throw new UnprocessableEntityException('TURNSTILE_TOKEN_INVALID');
    }

    return true;
  }
}
