import { computeAuditHash, type AuditHashInput } from './audit-hash';

const base: AuditHashInput = {
  actor: 'admin:11111111-1111-1111-1111-111111111111',
  actorUserId: null,
  actorAdminId: '11111111-1111-1111-1111-111111111111',
  subject: 'Role:22222222-2222-2222-2222-222222222222',
  action: 'admin_update',
  details: { field: 'permissions', count: 3 },
  before: { permissionIds: ['a', 'b'] },
  after: { permissionIds: ['a', 'b', 'c'] },
  createdAt: '2026-06-30T12:00:00.000Z',
  prevHash: '0',
};

describe('computeAuditHash', () => {
  it('is a 64-char hex sha-256 digest', () => {
    const h = computeAuditHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical input', () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }));
  });

  it('is independent of key order within details/before/after', () => {
    const reordered: AuditHashInput = {
      ...base,
      details: { count: 3, field: 'permissions' },
      after: { permissionIds: ['a', 'b', 'c'] },
    };
    expect(computeAuditHash(reordered)).toBe(computeAuditHash(base));
  });

  it('changes when the action changes', () => {
    expect(computeAuditHash({ ...base, action: 'admin_override' })).not.toBe(
      computeAuditHash(base),
    );
  });

  it('changes when the prevHash changes (chain linkage)', () => {
    expect(computeAuditHash({ ...base, prevHash: 'deadbeef' })).not.toBe(
      computeAuditHash(base),
    );
  });

  it('changes when the after-state changes', () => {
    expect(
      computeAuditHash({ ...base, after: { permissionIds: ['a'] } }),
    ).not.toBe(computeAuditHash(base));
  });

  it('treats undefined and null before/after identically (normalised)', () => {
    const withNull: AuditHashInput = { ...base, before: null, after: null };
    const withUndefined: AuditHashInput = {
      ...base,
      before: undefined,
      after: undefined,
    };
    expect(computeAuditHash(withUndefined)).toBe(computeAuditHash(withNull));
  });
});
