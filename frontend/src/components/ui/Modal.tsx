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
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  const modalContent = (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity animate-fade-in" 
        onClick={onClose}
      />
      
      {/* Modal Container */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div 
          className={clsx(
            "relative w-full bg-white rounded-3xl shadow-2xl overflow-hidden animate-slide-up flex flex-col max-h-[85vh]",
            sizeClasses[size]
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-surface-100">
            <h3 className="text-xl font-bold text-surface-900">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-surface-400 hover:bg-surface-50 hover:text-surface-600 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto pb-safe">
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
