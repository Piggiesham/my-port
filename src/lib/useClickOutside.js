import { useEffect } from 'react';

// Calls onOut() on a mousedown outside ref's element. Shared by every
// dropdown/popover in the app.
export function useClickOutside(ref, onOut) {
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOut();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOut]);
}
