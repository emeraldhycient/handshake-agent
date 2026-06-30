import { z } from "zod";

// Effective-setting DTOs — the admin console's view of a single config leaf as
// resolved by the layered config (root CLAUDE.md §7, DB-admin › env › JSON). Each
// row pairs a SETTING_REGISTRY entry's static metadata (key/category/label/…) with
// its CURRENT effective value and provenance (`source`: a DB override or the
// env/JSON default). Secret entries are never serialized into this shape.

export const SettingValueTypeSchema = z.enum([
  "number",
  "string",
  "boolean",
  "string[]",
]);
export type SettingValueTypeDto = z.infer<typeof SettingValueTypeSchema>;

export const SettingScopeSchema = z.enum(["global", "tier", "provider"]);
export type SettingScopeDto = z.infer<typeof SettingScopeSchema>;

export const SettingSourceSchema = z.enum(["db", "default"]);
export type SettingSourceDto = z.infer<typeof SettingSourceSchema>;

/** One config leaf as the admin console sees it (metadata + effective value). */
export const EffectiveSettingSchema = z.object({
  key: z.string(),
  category: z.string(),
  label: z.string(),
  description: z.string(),
  valueType: SettingValueTypeSchema,
  editable: z.boolean(),
  /** The current effective value — its runtime type matches `valueType`. */
  value: z.unknown(),
  /** 'db' when a matching AppSetting override exists, else 'default'. */
  source: SettingSourceSchema,
  scope: SettingScopeSchema,
  scopeValue: z.string().nullable(),
});
export type EffectiveSetting = z.infer<typeof EffectiveSettingSchema>;

export const EffectiveSettingListResponseSchema = z.object({
  settings: z.array(EffectiveSettingSchema),
});
export type EffectiveSettingListResponse = z.infer<
  typeof EffectiveSettingListResponseSchema
>;

/** PATCH /admin/settings/:key body — the proposed new value plus its scope. */
export const UpdateSettingRequestSchema = z.object({
  value: z.unknown(),
  scope: SettingScopeSchema.default("global"),
  scopeValue: z.string().nullable().default(null),
});
export type UpdateSettingRequest = z.infer<typeof UpdateSettingRequestSchema>;

/** GET /admin/settings query — optional category filter. */
export const SettingsQuerySchema = z.object({
  category: z.string().optional(),
});
export type SettingsQuery = z.infer<typeof SettingsQuerySchema>;
