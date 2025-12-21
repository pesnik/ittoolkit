'use client';

import * as React from 'react';
import { FluentProvider, webDarkTheme, webLightTheme, Theme } from '@fluentui/react-components';

export type AppTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: AppTheme;
  toggleTheme: () => void;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

export const useTheme = () => {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize with dark theme as default to match previous behavior
  const [currentThemeStr, setCurrentThemeStr] = React.useState<AppTheme>('dark');
  
  // Persist to localStorage if available
  React.useEffect(() => {
    const saved = localStorage.getItem('app-theme') as AppTheme;
    if (saved === 'light' || saved === 'dark') {
      setCurrentThemeStr(saved);
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setCurrentThemeStr((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('app-theme', next);
      return next;
    });
  }, []);

  const setTheme = React.useCallback((theme: AppTheme) => {
    setCurrentThemeStr(theme);
    localStorage.setItem('app-theme', theme);
  }, []);

  const fluentTheme: Theme = currentThemeStr === 'light' ? webLightTheme : webDarkTheme;

  const value = React.useMemo(() => ({
    theme: currentThemeStr,
    toggleTheme,
    setTheme,
  }), [currentThemeStr, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
        <FluentProvider theme={fluentTheme} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          {children}
        </FluentProvider>
    </ThemeContext.Provider>
  );
}
