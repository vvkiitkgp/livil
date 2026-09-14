// FIRST, and deliberately so: this module snapshots the URL before supabase-js is evaluated
// and strips the recovery `?code=` out of it during client construction. Move it below any
// import that reaches ./supabase and the password-reset gate silently stops working.
import './auth/recoveryEntry';
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
