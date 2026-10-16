import { useCallback, useState } from 'react';
import type { CvAiOutcome, CvAiReport } from '@shared/types';

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

  const analyze = useCallback(async (filePath: string) => {
    setBusy(true);
    setError(null);
    setAiOutcome(null);
    try {
      const parsed = await window.gotowork.parseCv({ filePath });
      const health = await window.gotowork.activeProviderHealth();
      if (health?.reachable) {
        // Provider connected: run the AI read of the CV (loading shown meanwhile).
        setAiLoading(true);
        try {
          setAiOutcome(await window.gotowork.aiReviewCv({ cv: parsed }));
        } finally {
          setAiLoading(false);
        }
      } else {
        // No live provider: the analysis returns nothing.
        setAiOutcome(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onPick = useCallback(async () => {
    const path = await pickCvFile();
    if (path) void analyze(path);
  }, [analyze]);

  return (
    <div>
      <header className="main-header">
        <h1>Analyse CV</h1>
        <p>Scan IA local de votre CV — verdict, points forts et recommandations. Rien ne quitte votre machine.</p>
      </header>

      <div className="content">
        <div className="card">
          <div className="row spread">
            <div>
              <div className="card-title">Votre CV</div>
              <div className="card-hint">PDF, DOCX ou TXT. Analyse 100% locale.</div>
            </div>
            <button className="btn primary" onClick={onPick} disabled={busy}>
              {busy ? 'Analyse…' : 'Choisir un CV'}
            </button>
          </div>

          {error && (
            <div className="badge bad" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </div>

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
  return (
    <div className="card">
      <div className="row spread">
        <div>
          <div className="card-title">Analyse IA</div>
          <div className="card-hint">Lecture du CV par le modèle local — comme un recruteur.</div>
        </div>
        {report.verdict && ENUM_VERDICTS.includes(report.verdict) && (
          <span className={`badge ${report.verdict === 'positive' ? 'ok' : report.verdict === 'neutral' ? '' : 'warn'}`}>
            {report.verdict === 'positive' ? 'Bon CV' : report.verdict === 'negative' ? 'À retravailler' : 'Moyen'}
          </span>
        )}
      </div>

      {report.verdict && !ENUM_VERDICTS.includes(report.verdict) && (
        <p className="verdict">{report.verdict}</p>
      )}

      {meta && <div className="ai-meta">{meta}</div>}

      <hr className="divider" />

      <div className="row spread">
        <div className="lbl">Lisibilité ATS</div>
        {report.atsScore > 0 && (
          <span className={`badge ${atsBadgeClass(report.atsScore)}`}>ATS {report.atsScore}/100</span>
        )}
      </div>
      {report.atsComment && <p className="hint">{report.atsComment}</p>}

      {(report.skills ?? []).length > 0 && (
        <>
          <div className="lbl">Compétences clés</div>
          <div className="skill-tags">
            {report.skills!.map((s) => (
              <span key={s} className="badge">
                {s}
              </span>
            ))}
          </div>
        </>
      )}

      <hr className="divider" />

      <div className="grid-2">
        <div>
          <div className="lbl">Points forts</div>
          <LabeledList items={strength} />
        </div>
        <div>
          <div className="lbl">À améliorer</div>
          <LabeledList items={weakness} />
        </div>
      </div>

      {(report.recommendations ?? []).length > 0 && (
        <>
          <hr className="divider" />
          <div className="lbl">Recommandations</div>
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
