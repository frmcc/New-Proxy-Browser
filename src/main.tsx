import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from './lib/register-sw.ts';

async function init() {
  try {
    await registerSW();
  } catch (err) {
    console.error('Failed to register service worker', err);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

init();
