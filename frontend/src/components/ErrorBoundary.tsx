import React, { Component, ErrorInfo, PropsWithChildren } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useTranslations, useLocale } from 'next-intl';
import { isRTLLocale } from '@/utils/locale';

// Props for the error boundary class component
interface ErrorBoundaryClassProps extends PropsWithChildren {
  fallback?: React.ReactNode;
  name?: string;
  resetKeys?: string;
  t: (key: string) => string;
  language: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary Class Component
 * Must be a class component because error boundaries can't be function components
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryClassProps, State> {
  public state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Send to Sentry if configured
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      Sentry.captureException(error, {
        extra: {
          componentStack: errorInfo.componentStack,
        },
        tags: { errorBoundary: this.props.name || 'root' },
      });
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryClassProps): void {
    // Reset error when route changes (via resetKeys prop)
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      this.props.resetKeys !== prevProps.resetKeys
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { t, language } = this.props;
      const isRTL = isRTLLocale(language);

      return (
        <div
          className="flex-1 bg-background flex items-center justify-center p-4"
          style={{
            // dvh, not vh: vh includes the mobile URL bar / keyboard area.
            // Inline (not Tailwind) so the error UI renders even if CSS broke.
            minHeight: '100dvh',
            paddingTop: 'var(--sai-top)',
            paddingBottom: 'var(--sai-bottom)',
          }}
        >
          <div
            dir={isRTL ? 'rtl' : 'ltr'}
            className="max-w-md w-full bg-card rounded-2xl p-8 text-center shadow-xl border border-theme-border"
          >
            {/* Error Icon */}
            <div className="w-16 h-16 mx-auto mb-6 rounded-full icon-bg-red flex items-center justify-center">
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Error Message */}
            <h1 className="text-xl font-semibold text-foreground mb-2">
              {t('title')}
            </h1>
            <p className="text-muted-foreground mb-6">{t('description')}</p>

            {/* Error Details (only in development) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-6 p-3 bg-background rounded-lg text-start overflow-auto max-h-32">
                <code className="text-xs text-red-600 dark:text-red-400 break-all">
                  {this.state.error.message}
                </code>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="btn-primary"
              >
                {t('refreshButton')}
              </button>
              <button
                onClick={this.handleGoHome}
                className="btn-secondary"
              >
                {t('homeButton')}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Error Boundary Wrapper (Function Component)
 * Provides translation hook to the class component
 */
export function ErrorBoundary({ children, ...props }: Omit<ErrorBoundaryClassProps, 't' | 'language'>) {
  const t = useTranslations('errorBoundary');
  const locale = useLocale();

  return (
    <ErrorBoundaryClass t={t} language={locale} {...props}>
      {children}
    </ErrorBoundaryClass>
  );
}

export default ErrorBoundary;
