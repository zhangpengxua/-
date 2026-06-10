import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { lightTheme, darkTheme, ThemeContext } from './theme';

function Root() {
  const [isDark, setIsDark] = useState(false);

  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

  const toggleDarkMode = () => setIsDark(prev => !prev);

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleDarkMode }}>
      <App />
    </ThemeContext.Provider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
