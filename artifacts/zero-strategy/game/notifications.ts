export type NotificationRecipient =
  | { scope: 'game' }
  | { scope: 'all' }
  | { scope: 'world' }
  | { scope: 'observer' }
  | { scope: 'country'; countryId: number };

export type NotificationSubscription =
  | { scope: 'any' }
  | { scope: 'game' }
  | { scope: 'all' }
  | { scope: 'world' }
  | { scope: 'observer' }
  | { scope: 'country'; countryId: number };

export type NotificationViewerRole = 'all' | 'country' | 'world' | 'observer';

export interface GameNotification {
  id: number;
  message: string;
  recipient: NotificationRecipient;
}

/** A viewer's subscriptions describe the notifications they can receive, not who processes turns. */
export function notificationSubscriptionsForViewer(
  role: NotificationViewerRole,
  countryId: number | null = null,
): NotificationSubscription[] {
  if (role === 'all') return [{ scope: 'any' }];
  if (role === 'world') return [{ scope: 'world' }];
  if (role === 'country' && countryId !== null) return [{ scope: 'country', countryId }];
  return [];
}

/** Matches an event recipient against explicit subscriptions, without regard to its producer. */
export function notificationIsForSubscriber(
  recipient: NotificationRecipient,
  subscriptions: readonly NotificationSubscription[],
): boolean {
  return subscriptions.some((subscription) =>
    subscription.scope === 'any' ||
    (subscription.scope === recipient.scope &&
      (recipient.scope !== 'country' ||
        (subscription.scope === 'country' && subscription.countryId === recipient.countryId))),
  );
}
