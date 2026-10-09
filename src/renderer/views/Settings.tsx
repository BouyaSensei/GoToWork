import { useCallback, useEffect, useState } from 'react';
import type { ProviderConfig, ProviderHealth, UserProfile } from '@shared/types';

const PRESETS: { kind: ProviderConfig['kind']; label: string; baseUrl: string; model: string }[] = [
  { kind: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' },
  { kind: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: 'local-model' }
];

export default function Settings({ onProviderChange }: { onProviderChange: (p: ProviderConfig | null) => void }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [profile, setProfile] = useState<UserProfile>({
    fullName: '', email: '', phone: '', linkedinUrl: '', portfolioUrl: '', location: '', coverLetter: ''
  });
  const [health, setHealth] = useState<Record<string, ProviderHealth>>({});
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ps = await window.gotowork.listProviders();
    setProviders(ps);
    onProviderChange(ps.find((p) => p.enabled) ?? ps[0] ?? null);
  }, [onProviderChange]);

  useEffect(() => {
    void refresh();
    window.gotowork.getProfile().then(setProfile);
  }, [refresh]);

  const testHealth = async (id: string) => {
    const h = await window.gotowork.providerHealth({ providerId: id });
    setHealth((prev) => ({ ...prev, [id]: h }));
  };

  const addProvider = (preset?: (typeof PRESETS)[number]) => {
    const base = preset ?? { kind: 'openai-compatible' as const, label: 'OpenAI-compatible', baseUrl: 'http://localhost:8080/v1', model: '' };
    const p: ProviderConfig = {
      id: `prov_${Date.now().toString(36)}`,
      kind: base.kind,
      label: base.label,
      baseUrl: base.baseUrl,
      model: base.model,
      apiKey: '',
      enabled: true
    };
    setProviders((ps) => [...ps, p]);
  };

  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => {
    setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const saveAll = async () => {
    for (const p of providers) await window.gotowork.saveProvider(p);
    await window.gotowork.saveProfile({ profile });
    setSavedMsg('Enregistré.');
    setTimeout(() => setSavedMsg(null), 2000);
    void refresh();
  };

  return (
    <div>
      <header className="main-header">
        <h1>Réglages</h1>
        <p>Providers IA locaux, profil de candidature et champs prédefinis.</p>
      </header>

      <div className="content">
        {/* Profile */}
        <div className="card">
          <div className="card-title">Profil &amp; champs prédefinis</div>
          <div className="card-hint">Utilisés pour compléter 100% des formulaires de candidature.</div>

          <div className="grid-2">
            <div>
              <label className="lbl">Nom complet</label>
              <input className="field" value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
              <label className="lbl">Email</label>
              <input className="field" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>
            <div>
              <label className="lbl">Téléphone</label>
              <input className="field" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
              <label className="lbl">Lien LinkedIn</label>
              <input className="field" placeholder="https://linkedin.com/in/…" value={profile.linkedinUrl} onChange={(e) => setProfile({ ...profile, linkedinUrl: e.target.value })} />
            </div>
          </div>

          <div className="grid-2">
            <div>
              <label className="lbl">Portfolio / site (optionnel)</label>
              <input className="field" value={profile.portfolioUrl ?? ''} onChange={(e) => setProfile({ ...profile, portfolioUrl: e.target.value })} />
            </div>
            <div>
              <label className="lbl">Localisation</label>
              <input className="field" value={profile.location ?? ''} onChange={(e) => setProfile({ ...profile, location: e.target.value })} />
            </div>
          </div>

          <label className="lbl">Lettre de motivation (scannée par l’IA)</label>
          <textarea
            className="field"
            style={{ minHeight: 120 }}
            value={profile.coverLetter}
            onChange={(e) => setProfile({ ...profile, coverLetter: e.target.value })}
            placeholder="Votre lettre de motivation générique, personnalisée par l’IA selon chaque offre…"
          />
        </div>

        {/* Providers */}
        <div className="card">
          <div className="row spread" style={{ marginBottom: 14 }}>
            <div>
              <div className="card-title">Providers IA locaux</div>
              <div className="card-hint">Ollama, LM Studio ou n’importe quel endpoint OpenAI-compatible.</div>
            </div>
            <div className="row">
              {PRESETS.map((p) => (
                <button key={p.kind} className="btn ghost" onClick={() => addProvider(p)}>+ {p.label}</button>
              ))}
              <button className="btn" onClick={() => addProvider()}>+ Custom</button>
            </div>
          </div>

          {providers.length === 0 && (
            <div className="empty">Aucun provider. Ajoutez Ollama ou LM Studio pour activer l’assistant et le scoring IA.</div>
          )}

          {providers.map((p) => (
            <div key={p.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="grid-2">
                <div>
                  <label className="lbl">Libellé</label>
                  <input className="field" value={p.label} onChange={(e) => updateProvider(p.id, { label: e.target.value })} />
                  <label className="lbl">Base URL</label>
                  <input className="field mono" value={p.baseUrl} onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })} />
                </div>
                <div>
                  <label className="lbl">Modèle</label>
                  <input className="field mono" value={p.model} onChange={(e) => updateProvider(p.id, { model: e.target.value })} />
                  <label className="lbl">API key (optionnel)</label>
                  <input className="field mono" type="password" value={p.apiKey ?? ''} onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })} />
                </div>
              </div>
              <div className="row mt">
                <button className="btn ghost" onClick={() => void testHealth(p.id)}>Tester la connexion</button>
                <button className="btn ghost" onClick={() => updateProvider(p.id, { enabled: !p.enabled })}>
                  {p.enabled ? 'Actif' : 'Inactif'}
                </button>
                <button className="btn ghost" style={{ color: 'var(--bad)' }} onClick={() => setProviders((ps) => ps.filter((x) => x.id !== p.id))}>
                  Supprimer
                </button>
                {health[p.id] && (
                  <span className={`badge ${health[p.id].reachable ? 'ok' : 'bad'}`}>
                    {health[p.id].reachable
                      ? `OK · ${health[p.id].models?.length ?? 0} modèle(s)`
                      : `Échec: ${health[p.id].error}`}
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="row mt">
            <button className="btn primary" onClick={saveAll}>Enregistrer tout</button>
            {savedMsg && <span className="badge ok">{savedMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
