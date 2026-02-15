import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

console.log('[main] Mounting React app...');

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<h1 style="color:red">No #root element found</h1>';
} else {
  try {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    console.log('[main] React render called');
  } catch (err) {
    console.error('[main] Render error:', err);
    root.innerHTML = `<pre style="color:red;padding:20px">${err}</pre>`;
  }
}
