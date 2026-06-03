import { useEffect, useState } from 'react';

/**
 * Resolved dark-mode boolean, observed from the `.dark` class on <html>.
 *
 * Unlike {@link useTheme} (which exposes the raw `light | dark | system`
 * preference), this returns the THEME ACTUALLY RENDERED — correct even when the
 * preference is `system`. Use it anywhere a concrete light/dark value is needed
 * at runtime, e.g. the Stripe Elements appearance on the checkout page and the
 * top-up modal.
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
