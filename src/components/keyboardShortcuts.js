// keyboardShortcuts.js
import { useEffect } from 'react';

export const useKeyboardShortcuts = () => {
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Ctrl + Alt + P
      if (event.ctrlKey && event.altKey && event.key === 'p') {
        event.preventDefault();
        
        // Dispatch a custom event that components can listen for
        const shortcutEvent = new CustomEvent('openAddProductModal');
        window.dispatchEvent(shortcutEvent);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
};

// Helper function to manually trigger the modal open
export const triggerAddProductModal = () => {
  const shortcutEvent = new CustomEvent('openAddProductModal');
  window.dispatchEvent(shortcutEvent);
};