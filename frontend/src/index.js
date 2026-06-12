import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeContext, lightTheme, darkTheme } from './theme';

function Root() {
  const [isDark, setIsDark] = useState(false);

  const toggleDarkMode = () => setIsDark((prev) => !prev);
  const theme = useMemo(() => (isDark ? darkTheme : lightTheme), [isDark]);

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
