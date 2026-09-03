import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AudioLab from './components/AudioLab.tsx';
import './index.css';

// Open with `?lab` in the URL to load the decoupled-audio test bench instead of
// the full app. Keeps App.tsx untouched during the audio rearchitecture.
const isLab =
  typeof window !== 'undefined' && /[?&]lab\b/.test(window.location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isLab ? <AudioLab /> : <App />}</StrictMode>,
);
