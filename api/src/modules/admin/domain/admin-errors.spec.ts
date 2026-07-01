import {
  AdminError,
  AdminInvalidCredentialsError,
  AdminMfaRequiredError,
  AdminStepUpRequiredError,
  BuiltinRoleImmutableError,
  AdminInvitationInvalidError,
} from './admin-errors';

describe('admin-errors', () => {
  it('expose stable codes and remain instanceof AdminError/Error', () => {
    const cases: [AdminError, string][] = [
      [new AdminInvalidCredentialsError(), 'ADMIN_INVALID_CREDENTIALS'],
      [new AdminMfaRequiredError(), 'ADMIN_MFA_REQUIRED'],
      [new AdminStepUpRequiredError(), 'ADMIN_STEP_UP_REQUIRED'],
      [new BuiltinRoleImmutableError(), 'ADMIN_BUILTIN_ROLE_IMMUTABLE'],
      [new AdminInvitationInvalidError(), 'ADMIN_INVITATION_INVALID'],
    ];
    for (const [err, code] of cases) {
      expect(err).toBeInstanceOf(AdminError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});
