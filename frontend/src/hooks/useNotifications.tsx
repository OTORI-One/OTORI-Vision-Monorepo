import { useContext } from 'react';
import NotificationContext from '../context/NotificationContext';

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  // We only expose addNotification for now as remove is handled internally
  return { addNotification: context.addNotification };
}; 