import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Handle ESC key
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
    }

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const sizeClasses = {
    sm: 'max-w-md landscape:max-w-lg',
    md: 'max-w-xl landscape:max-w-2xl',
    lg: 'max-w-2xl landscape:max-w-3xl',
    xl: 'max-w-4xl landscape:max-w-5xl',
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity animate-fade-in" 
        onClick={onClose}
      />
      
      {/* Modal Container - Bottom sheet on mobile, centered on desktop/landscape */}
      <div className="flex min-h-screen items-end sm:items-center landscape:items-center justify-center p-0 sm:p-4 landscape:p-6">
        <div 
          className={clsx(
            "relative w-full bg-white shadow-2xl overflow-hidden animate-slide-up flex flex-col",
            // Mobile portrait: bottom sheet with safe area
            "rounded-t-3xl sm:rounded-3xl landscape:rounded-3xl",
            "max-h-[92vh] sm:max-h-[85vh] landscape:max-h-[90vh]",
            // Safe area padding: portrait = bottom, landscape = sides
            "pb-safe landscape:pb-2 landscape:px-safe",
            sizeClasses[size]
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 sm:p-6 border-b border-surface-100 flex-shrink-0">
            <h3 className="text-xl font-bold text-surface-900 leading-tight">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="p-2 -mr-2 sm:mr-0 rounded-xl text-surface-400 hover:bg-surface-50 hover:text-surface-600 transition-all flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body - scrollable content */}
          <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  // Return with portal
  const target = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  return target ? createPortal(modalContent, target) : modalContent;
}
