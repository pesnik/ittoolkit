'use client';

import * as React from 'react';
import { Button, Tooltip } from '@fluentui/react-components';
import { useTheme } from '../lib/ThemeContext';
import { WeatherSunnyRegular, WeatherMoonRegular } from '@fluentui/react-icons';

export const ThemeToggle = () => {
    const { theme, toggleTheme } = useTheme();

    // Explicitly check for dark mode
    const isDark = theme === 'dark';

    return (
        <Tooltip content={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"} relationship="label">
            <Button
                appearance="subtle"
                icon={isDark ? <WeatherMoonRegular /> : <WeatherSunnyRegular />}
                onClick={toggleTheme}
                aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
            />
        </Tooltip>
    );
};
