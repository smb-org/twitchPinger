import type { ComponentChildren } from 'preact';
import { store } from './store.ts';

const loc = store({ path: location.pathname, search: location.search });
const sync = () => loc.set({ path: location.pathname, search: location.search });
addEventListener('popstate', sync);

export function navigate(to: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  sync();
}
export const useLocation = () => loc.use();
export const isPublicPath = (p: string) => p === '/login' || p.startsWith('/invite/');

interface LinkProps { href: string; class?: string; children?: ComponentChildren; 'aria-current'?: 'page'; onClick?: (e: MouseEvent) => void }
export function Link({ href, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    />
  );
}
