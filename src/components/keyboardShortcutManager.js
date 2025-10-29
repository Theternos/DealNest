// KeyboardShortcutManager.js
import { useEffect } from 'react';

const shortcutHandlers = new Map();

export const useKeyboardShortcut = (key, callback, dependencies = []) => {
  useEffect(() => {
    const handler = (event) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === key.toLowerCase()) {
        event.preventDefault();
        callback();
      }
    };

    // Add to global handlers
    const handlerId = `${key}-${Date.now()}-${Math.random()}`;
    shortcutHandlers.set(handlerId, handler);

    // Add event listener
    document.addEventListener('keydown', handler);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handler);
      shortcutHandlers.delete(handlerId);
    };
  }, [key, callback, ...dependencies]);
};

export const registerGlobalShortcut = (key, callback) => {
  const handler = (event) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === key.toLowerCase()) {
      event.preventDefault();
      callback();
    }
  };

  document.addEventListener('keydown', handler);
  return () => {
    document.removeEventListener('keydown', handler);
  };
};