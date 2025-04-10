import React, { useContext } from 'react';
import NotificationContext from '../src/context/NotificationContext'; // Adjusted path
import NotificationToast from './NotificationToast'; // Path within the same directory

const NotificationContainer: React.FC = () => {
  const context = useContext(NotificationContext);

  if (!context) {
    return null;
  }

  const { notifications, removeNotification } = context;

  return (
    <div
      aria-live="assertive"
      className="fixed inset-0 flex flex-col items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-end sm:justify-start z-50 space-y-2"
    >
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={removeNotification}
        />
      ))}
    </div>
  );
};

export default NotificationContainer; 