import { useEffect, useRef, useState } from 'react';
import type { ChatTurn } from '@shared/types';

export default function ChatbotView() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    const userTurn: ChatTurn = { id: `u${Date.now()}`, role: 'user', content: msg, ts: Date.now() };
    setTurns((t) => [...t, userTurn]);

    try {
      // Build a lightweight context from the profile; deep CV context is added
      // by the main process when a CV has been analyzed in this session.
      const reply = await window.gotowork.chatAsk({
        message: msg,
        context: {}
      });
      const aiTurn: ChatTurn = { id: `a${Date.now()}`, role: 'assistant', content: reply, ts: Date.now() };
      setTurns((t) => [...t, aiTurn]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="main-header">
        <h1>Assistant</h1>
        <p>Questionnez vos résultats, l’avancée de la recherche, ou demandez conseil — propulsé par votre IA locale.</p>
      </header>

      <div className="content" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 76px)' }}>
        <div className="chat" style={{ flex: 1 }}>
          {turns.length === 0 && !busy && (
            <div className="empty">
              Posez une question : « Quelles offres valent le coup ? », « Pourquoi je n’ai pas été auto-candidat ? », « Comment améliorer mon score ATS ? »
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className={`bubble ${t.role}`}>
              {t.content}
            </div>
          ))}
          {busy && <div className="bubble assistant">…</div>}
          {error && <div className="badge bad">{error}</div>}
          <div ref={endRef} />
        </div>

        <div className="row mt" style={{ flexShrink: 0 }}>
          <textarea
            className="field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Votre question… (Entrée pour envoyer)"
            style={{ minHeight: 48, flex: 1 }}
          />
          <button className="btn primary" onClick={send} disabled={busy || !input.trim()}>
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
