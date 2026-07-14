import { ConfigService } from '@nestjs/config';
import { MockEmailProvider } from './mock-email.provider';

function make(webBase?: string) {
  const config = {
    get: (key: string) => (key === 'WEB_APP_BASE_URL' ? webBase : undefined),
  } as unknown as ConfigService;
  return new MockEmailProvider(config);
}

describe('MockEmailProvider', () => {
  it('resolves for sendEmailVerification and includes the link in the log', async () => {
    const provider = make('https://app.test');
    const spy = jest.spyOn(provider['logger'], 'log');
    await expect(
      provider.sendEmailVerification('a@b.com', 'tok123'),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('https://app.test/verify-email?token=tok123'),
    );
  });

  it('resolves for sendLoginOtp and logs the code', async () => {
    const provider = make('https://app.test');
    const spy = jest.spyOn(provider['logger'], 'log');
    await expect(
      provider.sendLoginOtp('a@b.com', '123456'),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('123456'));
  });

  it('resolves for sendLoginInstead and logs the recipient (no OTP/code involved)', async () => {
    const provider = make('https://app.test');
    const spy = jest.spyOn(provider['logger'], 'log');
    await expect(provider.sendLoginInstead('a@b.com')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('a@b.com'));
  });
});
