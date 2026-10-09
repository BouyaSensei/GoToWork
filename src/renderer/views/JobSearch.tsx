import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobPosting, ParsedCV, SearchMode, SearchRun } from '@shared/types';
import { parseManualPostings } from '@shared/manualPostings';

const MODES: { id: SearchMode; label: string; desc: string }[] = [
  { id: 'basic', label: 'Basique', desc: 'Recommandations uniquement, aucune auto-candidature.' },
  { id: 'hybrid', label: 'Hybride', desc: 'Jusqu’au lien de candidature, avec votre validation.' },
  { id: 'total', label: 'Total', desc: 'Automatisation complète du process A→Z.' }
];

export default function JobSearch() {
  const [mode, setMode] = useState<SearchMode>('basic');
  const [query, setQuery] = useState('');
  const [blob, setBlob] = useState('');
  const [cvPath, setCvPath] = useState<string | null>(null);
  const [run, setRun] = useState<SearchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cvRef = useRef<ParsedCV | null>(null);

  // Live status push from the main process.
  useEffect(() => {
    const off = window.gotowork.onSearchStatus((r) => setRun(r));
    return off;
  }, []);

  const loadCv = useCallback(async () => {
    const path = await window.gotowork.pickFile({
      title: 'Choisir votre CV',
      filters: [{ name: 'CV', extensions: ['pdf', 'docx', 'txt', 'md'] }]
    });
    if (path) {
      setCvPath(path);
      const cv = await window.gotowork.parseCv({ filePath: path });
      cvRef.current = cv;
    }
  }, []);

  const start = useCallback(async () => {
    if (!cvRef.current) {
      setError('Chargez d’abord votre CV.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const postings: JobPosting[] = blob.trim() ? parseManualPostings(blob) : [];
      const result = await window.gotowork.runSearch({
        mode,
        query: query || 'recherche',
        postings,
        cv: cvRef.current
      });
      setRun(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mode, query, blob]);

  return (
    <div>
      <header className="main-header">
        <h1>Recherche d’emploi</h1>
        <p>Matching seniorité-aware : un CV junior ne postule jamais à une offre senior.</p>
      </header>

      <div className="content">
        <div className="card">
          <div className="card-title">Mode de recherche</div>
          <div className="card-hint">Choisissez jusqu’où l’outil va tout seul.</div>
          <div className="grid-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`btn ${mode === m.id ? 'primary' : ''}`}
                style={{ textAlign: 'left', padding: 14 }}
                onClick={() => setMode(m.id)}
              >
                <div style={{ fontWeight: 600 }}>{m.label}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{m.desc}</div>
              </button>
            ))}
          </div>

          <label className="lbl">Votre CV</label>
          <div className="row">
            <button className="btn" onClick={loadCv}>Choisir un CV</button>
            {cvPath && <span className="muted mono" style={{ fontSize: 12 }}>{cvPath.split(/[\\/]/).pop()}</span>}
          </div>

          <label className="lbl">Requête (poste, ville, mots-clés)</label>
          <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ex: développeur frontend React, Paris, remote" />

          <label className="lbl">Offres (coller ici — format : Titre | Société | Lieu | URL, une par bloc)</label>
          <textarea
            className="field"
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
            placeholder={'Senior Frontend Dev | Acme Corp | Paris | https://…\nReact, TypeScript, 5 ans d’expérience…\n\nJunior Backend | StartupX | Remote | https://…\nPython, FastAPI…'}
            style={{ minHeight: 120 }}
          />

          <div className="row mt">
            <button className="btn primary" onClick={start} disabled={busy}>
              {busy ? 'Lancement…' : `Lancer la recherche (${MODES.find((m) => m.id === mode)?.label})`}
            </button>
          </div>

          {error && <div className="badge bad mt">{error}</div>}
        </div>

        {run && <RunPanel run={run} />}
      </div>
    </div>
  );
}

function RunPanel({ run }: { run: SearchRun }) {
  const statusLabel: Record<SearchRun['status'], string> = {
    idle: 'En attente',
    searching: 'Recherche…',
    'awaiting-approval': 'En attente de validation',
    applying: 'Candidature en cours…',
    done: 'Terminé',
    error: 'Erreur'
  };

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title">Résultats</div>
          <div className="card-hint">{run.results.length} offre(s) · {run.appliedJobIds.length} candidature(s)</div>
        </div>
        <span className={`badge ${run.status === 'done' ? 'ok' : run.status === 'error' ? 'bad' : 'warn'}`}>
          {statusLabel[run.status]}
        </span>
      </div>

      {run.status === 'awaiting-approval' && run.pendingApproval && (
        <div className="card" style={{ borderColor: 'var(--accent-dim)', background: 'var(--accent-soft)', marginBottom: 16 }}>
          <div className="card-title">Validation requise (mode hybride)</div>
          <div className="card-hint" style={{ marginBottom: 12 }}>
            Candidater à « {run.pendingApproval.title} » chez {run.pendingApproval.company} ?
          </div>
          <div className="row">
            <button
              className="btn primary"
              onClick={() =>
                window.gotowork.respondApproval(run.id, run.pendingApproval!.jobId, true)
              }
            >
              Candidater
            </button>
            <button
              className="btn"
              onClick={() =>
                window.gotowork.respondApproval(run.id, run.pendingApproval!.jobId, false)
              }
            >
              Passer
            </button>
          </div>
        </div>
      )}

      {run.results.length === 0 ? (
        <div className="empty">Aucune offre analysée. Collez des offres ci-dessus et relancez.</div>
      ) : (
        run.results.map((m) => (
          <JobResult key={m.jobId} match={m} />
        ))
      )}

      {run.log.length > 0 && (
        <>
          <div className="divider" />
          <div className="card-hint" style={{ marginBottom: 8 }}>Journal</div>
          <div className="log">
            {run.log.map((l, i) => (
              <div key={i} className={`log-line ${l.level}`}>
                <span className="ts">{new Date(l.ts).toLocaleTimeString('fr-FR')}</span>
                <span className="msg">{l.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function JobResult({ match }: { match: import('@shared/types').MatchScore }) {
  const scorePct = (match.score * 100).toFixed(0);
  return (
    <div className="job-card">
      <div className="job-head">
        <div>
          <div className="job-title">Offre #{match.jobId.slice(-4)}</div>
          <div className="job-co">Fit : {scorePct}% · seniorité effective {match.seniorityFit}</div>
        </div>
        <span className={`badge ${match.eligibleForAutoApply ? 'ok' : 'warn'}`}>
          {match.eligibleForAutoApply ? 'Éligible auto-candidature' : 'Non éligible'}
        </span>
      </div>
      <div className="job-meta">
        {match.skillMatches.slice(0, 8).map((s) => (
          <span key={s} className="badge ok">{s}</span>
        ))}
        {match.skillGaps.slice(0, 4).map((s) => (
          <span key={s} className="badge bad">{s}</span>
        ))}
      </div>
      {match.reasons.length > 0 && (
        <ul className="job-reasons">
          {match.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
