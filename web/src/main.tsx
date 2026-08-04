import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { installThemeVars } from './theme';
import { App } from './App';

// Before first paint, so nothing renders against unset variables.
installThemeVars();

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
