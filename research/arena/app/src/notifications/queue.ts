import type { AppContext, MailMessage, Mailer, Notification, NotificationKind, Order } from '../types.ts';
import { renderNotification } from './templates.ts';

/** A mailer that just remembers what it was asked to send. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
    },
  };
}

/** Try to send one queued notification. A failing mailer leaves it queued for a later flush. */
export function deliver(ctx: AppContext, notification: Notification): Notification {
  const user = ctx.store.users.get(notification.userId);
  if (!user) return notification;
  try {
    ctx.mailer.send({ to: user.email, subject: notification.subject, body: notification.body });
  } catch {
    return notification;
  }
  return ctx.store.notifications.update(notification.id, {
    status: 'sent',
    sentAt: ctx.clock.now().toISOString(),
  });
}

export function enqueueNotification(ctx: AppContext, kind: NotificationKind, order: Order): Notification {
  const { subject, body } = renderNotification(kind, order, ctx.config.currency);
  const queued = ctx.store.notifications.insert({
    id: ctx.store.nextId('ntf'),
    userId: order.userId,
    kind,
    subject,
    body,
    status: 'queued',
    createdAt: ctx.clock.now().toISOString(),
    sentAt: null,
  });
  return deliver(ctx, queued);
}

/** Retry everything still queued. Returns how many went out. */
export function flushNotifications(ctx: AppContext): number {
  const queued = ctx.store.notifications.find((n) => n.status === 'queued');
  return queued.map((n) => deliver(ctx, n)).filter((n) => n.status === 'sent').length;
}

/** A user's notifications, newest first. */
export function listNotifications(ctx: AppContext, userId: string): Notification[] {
  return ctx.store.notifications
    .find((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
