export interface Notification {
  id: number;
  title: string;
  message: string;
}

export function NotificationBanner({
  notifications,
}: {
  notifications: Notification[];
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="notification-container">
      {notifications.map((n) => (
        <div key={n.id} className="notification">
          <strong>{n.title}</strong>
          <span>{n.message}</span>
        </div>
      ))}
    </div>
  );
}
