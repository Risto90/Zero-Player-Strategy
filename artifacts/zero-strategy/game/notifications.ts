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

/** Matches an event recipient against the viewer's subscriptions, without regard to its producer. */
export function notificationIsForSubscriber(
  recipient: NotificationRecipient,
  subscriptions: readonly NotificationSubscription[],
): boolean {
  if (recipient.scope === 'game') return true;
  return subscriptions.some((subscription) =>
    subscription.scope === 'any' ||
    (subscription.scope === recipient.scope &&
      (recipient.scope !== 'country' ||
        (subscription.scope === 'country' && subscription.countryId === recipient.countryId))),
  );
}
