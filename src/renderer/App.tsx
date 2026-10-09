import React, { useEffect, useState } from 'react';
import type { ProviderConfig } from '@shared/types';
import CvAnalysis from './views/CvAnalysis';
import JobSearch from './views/JobSearch';
import ChatbotView from './views/ChatbotView';
import Settings from './views/Settings';

type View = 'cv' | 'search' | 'chat' | 'settings';

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  {
    id: 'cv',
    label: 'Analyse CV',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14 3v5h5M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    )
  },
  {
    id: 'search',
    label: 'Recherche d’emploi',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    )
  },
  {
    id: 'chat',
    label: 'Assistant',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: 'Réglages',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 12H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3h.1A1.6 1.6 0 0 0 12 4.6V5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
      </svg>
    )
  }
];

export default function App() {
  const [view, setView] = useState<View>('cv');
  const [provider, setProvider] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    window.gotowork.listProviders().then((ps) => {
      // Pick the first enabled provider as the "active" indicator.
      setProvider(ps.find((p) => p.enabled) ?? ps[0] ?? null);
    });
  }, [view]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
            <div className="brand-name">GoToWork</div>
            <div className="brand-sub">Job-search copilot</div>
          </div>
        </div>

        {NAV.map((n) => (
          <div
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="provider-pill">
            <span className={`dot ${provider ? 'on' : ''}`} />
            <span>{provider ? provider.label : 'Aucun IA local'}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {view === 'cv' && <CvAnalysis />}
        {view === 'search' && <JobSearch />}
        {view === 'chat' && <ChatbotView />}
        {view === 'settings' && <Settings onProviderChange={setProvider} />}
      </main>
    </div>
  );
}
