import React, { createContext, useState, useCallback, ReactNode, useMemo } from 'react';

export type NotificationType = 'success' | 'error' | 'info';

export interface Notification {
  id: string; // Use string for ID for more flexibility (e.g., uuid)
  type: NotificationType;
  message: string;
  duration?: number; // Optional duration per notification
}

interface NotificationContextProps {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id'>) => void;
  removeNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

const DEFAULT_DURATION = 6000; // 6 seconds

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prevNotifications) =>
      prevNotifications.filter((notification) => notification.id !== id)
    );
  }, []);

  const addNotification = useCallback(
    (notification: Omit<Notification, 'id'>) => {
      const id = Date.now().toString() + Math.random().toString(36).substring(2, 9); // Simple unique enough ID
      const newNotification: Notification = {
        ...notification,
        id,
      };

      setNotifications((prevNotifications) => [...prevNotifications, newNotification]);

      const duration = notification.duration || DEFAULT_DURATION;
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    },
    [removeNotification]
  );

  const contextValue = useMemo(() => ({
    notifications,
    addNotification,
    removeNotification,
  }), [notifications, addNotification, removeNotification]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext; 