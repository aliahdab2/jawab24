import React from 'react';
import clsx from 'clsx';

interface PremiumSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  color?: string;
}

export function PremiumSpinner({ size = 'md', className, color = 'currentColor' }: PremiumSpinnerProps) {
  const sizeMap = {
    sm: 16,
    md: 24,
    lg: 40,
    xl: 64,
  };

  const svgSize = sizeMap[size];
  const strokeWidth = size === 'sm' ? 2 : size === 'md' ? 2.5 : 3;
  const radius = (svgSize - strokeWidth) / 2;
  const center = svgSize / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div 
      className={clsx('relative inline-flex items-center justify-center', className)}
      style={{ width: svgSize, height: svgSize }}
    >
      <svg
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="animate-spin-slow"
        style={{
          width: svgSize,
          height: svgSize,
          transformOrigin: 'center',
          animation: 'premium-spin 1.4s linear infinite',
        }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            strokeDashoffset: circumference * 0.75,
            opacity: 0.2,
          }}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{
            animation: 'premium-dash 1.4s ease-in-out infinite',
          }}
        />
      </svg>

      <style jsx global>{`
        @keyframes premium-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes premium-dash {
          0% {
            stroke-dashoffset: ${circumference};
            transform: rotate(0deg);
          }
          50% {
            stroke-dashoffset: ${circumference * 0.2};
            transform: rotate(135deg);
          }
          100% {
            stroke-dashoffset: ${circumference};
            transform: rotate(450deg);
          }
        }
      `}</style>
    </div>
  );
}
