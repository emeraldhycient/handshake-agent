/**
 * Shared e2e helper: mint a verified user via the NEW onboarding path
 * (email-OTP → tier_1 [+ optional PIN]; optional signed Sumsub webhook → tier_2/3).
 * Replaces the legacy `signup → verify-email → login → kyc/submit` setup that the
 * retired /kyc/submit endpoint served. Mirrors onboarding-vertical.e2e-spec.ts.
 */
import { createHmac } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';

// supertest is a CommonJS module; allowSyntheticDefaultImports lets us import it
// as a default, and ts-jest's CJS interop makes it callable as a function.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { drainWebhooks } from './drain-webhooks';

export interface MintedUser {
  accessToken: string;
  userId: string;
  email: string;
  deviceFingerprint: string;
}

/**
 * Email-OTP signup → active tier_1 session. Sets a PIN too when `opts.pin` is
 * given (via POST /kyc/pin — allowed for tier_1 users). Requires the suite's
 * env to have `AUTH_DEV_EXPOSE_OTP=true` (the devOtp echo).
 */
export async function mintTier1User(
  app: INestApplication,
  opts: { email?: string; pin?: string } = {},
): Promise<MintedUser> {
  const email =
    opts.email ??
    `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.com`;
  const deviceFingerprint = `e2e-fp-${email.slice(0, 24)}`;

  const sr = await request(app.getHttpServer())
    .post('/auth/signup/request')
    .send({ email })
    .expect(200);
  const { devOtp } = sr.body as { status: string; devOtp: string };

  const sv = await request(app.getHttpServer())
    .post('/auth/signup/verify')
    .send({ email, otp: devOtp, deviceFingerprint })
    .expect(200);
  const svBody = sv.body as { accessToken: string; user: { userId: string } };
  const accessToken = svBody.accessToken;
  const userId = svBody.user.userId;

  if (opts.pin) {
    await request(app.getHttpServer())
      .post('/kyc/pin')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pin: opts.pin })
      .expect(200);
  }

  return { accessToken, userId, email, deviceFingerprint };
}

/**
 * Posts a signed GREEN Sumsub `applicantReviewed` webhook for `levelName` and
 * drains the durable queue, so the mapped tier (tier_2/tier_3) is granted +
 * kycStatus becomes 'verified'. The suite must set SUMSUB_WEBHOOK_SECRET and the
 * SUMSUB_LEVEL_TIER2/3 env matching `levelName` in its beforeAll.
 */
export async function grantTierViaSumsubWebhook(
  app: INestApplication,
  params: {
    userId: string;
    levelName: string;
    secret: string;
    applicantId?: string;
  },
): Promise<void> {
  const payload = {
    type: 'applicantReviewed',
    applicantId: params.applicantId ?? `mock-app-${params.userId}`,
    externalUserId: params.userId,
    levelName: params.levelName,
    reviewResult: { reviewAnswer: 'GREEN' },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', params.secret)
    .update(rawBody)
    .digest('hex');

  await request(app.getHttpServer())
    .post('/webhooks/sumsub')
    .set('Content-Type', 'application/json')
    .set('x-payload-digest', signature)
    .set('x-payload-digest-alg', 'HMAC_SHA256_HEX')
    .send(payload)
    .expect(200);

  await drainWebhooks(app);
}
