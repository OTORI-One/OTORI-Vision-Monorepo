import React from 'react';
import { Notification, NotificationType } from '../src/context/NotificationContext'; // Adjusted path from components to src/context
import { XMarkIcon, CheckCircleIcon, ExclamationCircleIcon, InformationCircleIcon } from '@heroicons/react/24/solid';

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss }) => {
  const baseClasses = 'relative w-full max-w-sm p-4 rounded-md shadow-lg flex items-start space-x-3';

  const typeClasses: Record<NotificationType, string> = {
    success: 'bg-cyan-50 text-cyan-800 border border-cyan-200',
    error: 'bg-red-50 text-red-800 border border-red-200',
    info: 'bg-blue-50 text-blue-800 border border-blue-200',
  };

  const IconComponent: Record<NotificationType, React.ElementType> = {
    success: CheckCircleIcon,
    error: ExclamationCircleIcon,
    info: InformationCircleIcon,
  };

  const Icon = IconComponent[notification.type];

  return (
    <div className={`${baseClasses} ${typeClasses[notification.type]}`}>
      <div className="flex-shrink-0">
        <Icon className={`h-5 w-5 ${
          notification.type === 'success' ? 'text-cyan-500' :
          notification.type === 'error' ? 'text-red-500' :
          'text-blue-500'
        }`} aria-hidden="true" />
      </div>
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium">{notification.message}</p>
      </div>
      <div className="flex-shrink-0 ml-4 flex">
        <button
          onClick={() => onDismiss(notification.id)}
          className={`inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
            notification.type === 'success' ? 'text-cyan-500 hover:bg-cyan-100 focus:ring-cyan-600 focus:ring-offset-cyan-50' :
            notification.type === 'error' ? 'text-red-500 hover:bg-red-100 focus:ring-red-600 focus:ring-offset-red-50' :
            'text-blue-500 hover:bg-blue-100 focus:ring-blue-600 focus:ring-offset-blue-50'
          }`}
          aria-label="Dismiss"
        >
          <span className="sr-only">Dismiss</span>
          <XMarkIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default NotificationToast; 