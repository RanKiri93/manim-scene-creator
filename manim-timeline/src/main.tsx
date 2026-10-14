import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './ErrorBoundary.tsx';
import 'katex/dist/katex.min.css';
// Self-hosted so the Tauri build works offline. Latin and Hebrew subsets only.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-400.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-500.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/frank-ruhl-libre/latin-500.css';
import '@fontsource/frank-ruhl-libre/hebrew-500.css';
import './index.css';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.DEV && window.location.hash === '#ui-gallery') {
  // Dev-only component reference; the branch and its chunk are dropped from production builds.
  void import('./components/ui/UiGallery').then(({ default: UiGallery }) =>
    root.render(
      <StrictMode>
        <UiGallery />
      </StrictMode>,
    ),
  );
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
