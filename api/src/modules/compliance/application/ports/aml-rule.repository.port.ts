/**
 * DI token and port for the AML-rule repository (admin CRUD).
 *
 * AmlRule is the admin-configurable, versioned rule the engine evaluates at txn
 * time. The console can list, create, and edit rules; every edit bumps `version`
 * so historical evaluations remain attributable to the rule snapshot they ran on.
 * Infrastructure implements this port with Prisma; the application layer never
 * imports the generated client (CLAUDE.md §3.2 / §4.1).
 */
export const AML_RULE_REPOSITORY = Symbol('AML_RULE_REPOSITORY');

/** App-layer unions mirroring the Prisma `AmlRuleType` / `AmlRuleAction` enums. */
export type AmlRuleTypeValue =
  | 'velocity_amount'
  | 'velocity_count'
  | 'behavior_pattern'
  | 'kyc_gate'
  | 'rate_limit';
export type AmlRuleActionValue = 'flag' | 'block';

/** DB-agnostic projection of an AML rule. */
export interface AmlRuleRecord {
  id: string;
  ruleKey: string;
  name: string;
  description: string;
  enabled: boolean;
  ruleType: AmlRuleTypeValue;
  action: AmlRuleActionValue;
  parameters: Record<string, unknown>;
  version: number;
}

export interface CreateAmlRuleInput {
  ruleKey: string;
  name: string;
  description: string;
  ruleType: AmlRuleTypeValue;
  action: AmlRuleActionValue;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

/** Partial patch — only the provided fields are updated. */
export interface UpdateAmlRuleInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  action?: AmlRuleActionValue;
  parameters?: Record<string, unknown>;
}

export interface IAmlRuleRepository {
  /** All AML rules, newest-first. */
  list(): Promise<AmlRuleRecord[]>;

  /** One rule by id; null if absent. */
  findById(id: string): Promise<AmlRuleRecord | null>;

  /** Create a rule, stamping createdByAdminId/updatedByAdminId = adminId. */
  create(input: CreateAmlRuleInput, adminId: string): Promise<AmlRuleRecord>;

  /**
   * Patch a rule and BUMP its version (version = version + 1), stamping
   * updatedByAdminId = adminId. Returns the updated record.
   */
  update(
    id: string,
    patch: UpdateAmlRuleInput,
    adminId: string,
  ): Promise<AmlRuleRecord>;
}
