import React from 'react';
import ReactDOM from 'react-dom/client';
import { FloatBubble } from './components/FloatBubble';
import { SettingsPanel } from './components/SettingsPanel';
import { HistoryPanel } from './components/HistoryPanel';
import './styles/globals.css';

function App() {
  // 通过 location.hash 区分窗口类型
  const hash = window.location.hash.replace('#', '');

  if (hash === 'settings') return <SettingsPanel />;
  if (hash === 'history') return <HistoryPanel />;
  return <FloatBubble />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
