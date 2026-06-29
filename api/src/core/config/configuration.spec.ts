import configuration from './configuration';

describe('configuration — statement', () => {
  it('exposes statement defaults', () => {
    const cfg = configuration();
    expect(cfg.statement).toEqual({
      linkTtlSeconds: 900,
      maxWindowDays: 365,
      rowCap: 100,
      timezoneOffsetMinutes: 60,
    });
  });
});
