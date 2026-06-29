import { z } from "zod";

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  eventRef: z.string(),
  createdAt: z.string(),
  templateVars: z.record(z.unknown()),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
});
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;
