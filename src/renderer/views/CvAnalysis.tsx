import { useCallback, useEffect, useRef, useState } from 'react';
import type { CvAiOutcome, CvAiReport, ParsedCV } from '@shared/types';

/** Pick a CV file via the native dialog and return its path (or null). */
async function pickCvFile(): Promise<string | null> {
  // The main process exposes a dialog helper via IPC.
  const res = await window.gotowork.pickFile({
    title: 'Choisir votre CV',
    filters: [{ name: 'CV', extensions: ['pdf', 'docx', 'txt', 'md'] }]
  });
  return res ?? null;
}

export default function CvAnalysis() {
  const [aiOutcome, setAiOutcome] = useState<CvAiOutcome | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The project CV: persisted once inserted, reused by every view until ejected.
  const [savedCv, setSavedCv] = useState<ParsedCV | null>(null);
  // Guards the (slow) AI scan against the StrictMode double-mount in dev.
  const scannedFor = useRef<string | null>(null);

  /** AI read of a CV — only when a local provider is actually reachable, so
   *  no template output is ever shown without a live model. */
  const runScan = useCallback(async (cv: ParsedCV) => {
    const health = await window.gotowork.activeProviderHealth();
    if (!health?.reachable) {
      // No live provider: the analysis returns nothing.
      setAiOutcome(null);
      return;
    }
    // Provider connected: run the AI read of the CV (loading shown meanwhile).
    setAiLoading(true);
    try {
      setAiOutcome(await window.gotowork.aiReviewCv({ cv }));
    } finally {
      setAiLoading(false);
    }
  }, []);

  // A persisted CV already exists: show it and run the scan for it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cv = await window.gotowork.getCv();
      if (!cv || cancelled) return;
      setSavedCv(cv);
      if (scannedFor.current === cv.sourceFile) return; // StrictMode double-mount
      scannedFor.current = cv.sourceFile;
      void runScan(cv);
    })();
    return () => {
      cancelled = true;
    };
  }, [runScan]);

  const analyze = useCallback(async (filePath: string) => {
    setBusy(true);
    setError(null);
    setAiOutcome(null);
    try {
      const parsed = await window.gotowork.parseCv({ filePath });
      // Persist the CV for the whole project (search matching included).
      await window.gotowork.saveCv({ cv: parsed });
      setSavedCv(parsed);
      scannedFor.current = parsed.sourceFile;
      await runScan(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [runScan]);

  const onPick = useCallback(async () => {
    const path = await pickCvFile();
    if (path) void analyze(path);
  }, [analyze]);

  const onEject = useCallback(async () => {
    await window.gotowork.clearCv();
    setSavedCv(null);
    setAiOutcome(null);
    scannedFor.current = null;
  }, []);

  return (
    <div>
      <header className="main-header">
        <h1>Analyse CV</h1>
        <p>Scan IA local de votre CV — verdict, points forts et recommandations. Rien ne quitte votre machine.</p>
      </header>

      <div className="content">
        {savedCv ? (
          <div className="card">
            <div className="row spread">
              <div>
                <div className="card-title">Votre CV</div>
                <div className="card-hint">
                  <span className="mono">{savedCv.sourceFile.split(/[\\/]/).pop()}</span>
                  {' · '}
                  {savedCv.title ?? 'Rôle non détecté'} · {savedCv.seniority}
                  {' — '}conservé pour tout le projet (recherche incluse), jusqu’à éjection.
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={onEject}>
                  Ejecter le CV
                </button>
                <button className="btn primary" onClick={onPick} disabled={busy}>
                  {busy ? 'Analyse…' : 'Remplacer le CV'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <div className="card-title">Aucun CV chargé</div>
            <p className="hint" style={{ maxWidth: 460, margin: '8px auto 20px' }}>
              Choisissez votre CV (PDF, DOCX ou TXT) — le scan est 100% local. Une fois inséré, il est
              conservé pour tout le projet, analyse et recherche d’emploi incluses, jusqu’à ce que vous
              l’éjectiez.
            </p>
            <button className="btn primary" style={{ fontSize: 15, padding: '10px 26px' }} onClick={onPick} disabled={busy}>
              {busy ? 'Analyse…' : 'Commencer le scan'}
            </button>
          </div>
        )}

        {error && (
          <div className="badge bad" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        {aiLoading && (
          <div className="card">
            <div className="row spread">
              <div>
                <div className="card-title">Analyse IA</div>
                <div className="card-hint">Scan du CV en cours — le premier passage peut prendre plusieurs minutes.</div>
              </div>
              <span className="ai-loading"><span className="spinner" />Scan en cours…</span>
            </div>
          </div>
        )}
        {aiOutcome?.ok && <AiPanel report={aiOutcome.report} />}
        {aiOutcome && !aiOutcome.ok && (
          <div className="card">
            <div className="row spread">
              <div>
                <div className="card-title">Analyse IA</div>
                <div className="card-hint">{aiOutcome.error.slice(0, 200)}</div>
              </div>
              <span className="badge warn">IA indisponible</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ENUM_VERDICTS: string[] = ['positive', 'neutral', 'negative'];

function atsBadgeClass(score: number): string {
  if (score >= 70) return 'ok';
  if (score >= 40) return '';
  return 'warn';
}

function AiPanel({ report }: { report: CvAiReport }) {
  const strength = (report.strengths ?? []).slice(0, 3);
  const weakness = (report.weaknesses ?? []).slice(0, 3);
  const meta = [report.role, report.seniority].filter(Boolean).join(' · ');
  const groups = report.skillGroups ?? [];
  return (
    <div className="card">
      <div className="row spread">
        <div>
          <div className="card-title">Analyse IA</div>
          <div className="card-hint">Lecture du CV par le modèle local — comme un recruteur.</div>
        </div>
        {report.verdict && ENUM_VERDICTS.includes(report.verdict) ? (
          <span className={`badge ${report.verdict === 'positive' ? 'ok' : report.verdict === 'neutral' ? '' : 'warn'}`}>
            {report.verdict === 'positive' ? 'Bon CV' : report.verdict === 'negative' ? 'À retravailler' : 'Moyen'}
          </span>
        ) : (
          report.atsScore > 0 && (
            <span className={`badge ${atsBadgeClass(report.atsScore)}`}>ATS {report.atsScore}/100</span>
          )
        )}
      </div>

      {report.verdict && !ENUM_VERDICTS.includes(report.verdict) && (
        <p className="verdict">{report.verdict}</p>
      )}

      {meta && <div className="ai-meta">{meta}</div>}

      {report.atsComment && (
        <>
          <hr className="divider" />
          <div className="sec-title">Lisibilité ATS</div>
          <p className="hint">{report.atsComment}</p>
        </>
      )}

      {groups.length > 0 && (
        <>
          <hr className="divider" />
          <div className="sec-title">Compétences clés</div>
          <div className="skill-groups">
            {groups.map((g) => (
              <div className="skill-group" key={g.cat}>
                <span className="skill-cat">{g.cat}</span>
                <div className="skill-tags">
                  {g.items.map((s) => (
                    <span key={s} className="badge">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <hr className="divider" />

      <div className="grid-2">
        <div>
          <div className="sec-title ok">Points forts</div>
          <LabeledList items={strength} />
        </div>
        <div>
          <div className="sec-title warn">À améliorer</div>
          <LabeledList items={weakness} />
        </div>
      </div>

      {(report.recommendations ?? []).length > 0 && (
        <>
          <hr className="divider" />
          <div className="sec-title">Recommandations</div>
          <ol className="rec-list">
            {report.recommendations!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function LabeledList({ items }: { items: string[] }) {
  if (!items.length) return <span className="hint">—</span>;
  return (
    <ul className="ai-list">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}
