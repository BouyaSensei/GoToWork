import { useCallback, useState } from 'react';
import type { AtsReport, CvAiReport, ParsedCV, SampleCvBundle, SampleLevel, SeniorityBand, SlopReport } from '@shared/types';

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
  const [cv, setCv] = useState<ParsedCV | null>(null);
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [slop, setSlop] = useState<SlopReport | null>(null);
  const [bundle, setBundle] = useState<SampleCvBundle | null>(null);
  const [aiReport, setAiReport] = useState<CvAiReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (filePath: string) => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await window.gotowork.parseCv({ filePath });
      setCv(parsed);
      const [health, atsReport, slopReport] = await Promise.all([
        window.gotowork.activeProviderHealth(),
        window.gotowork.analyzeAts({ cv: parsed }),
        window.gotowork.detectSlop({ cv: parsed })
      ]);
      setAts(atsReport);
      setSlop(slopReport);
      if (health?.reachable) {
        // Provider connected: run the AI read of the CV + the sample comparison.
        const [ai, bundle] = await Promise.all([
          window.gotowork.aiReviewCv({ cv: parsed }),
          window.gotowork.sampleCompare({ cv: parsed })
        ]);
        setAiReport(ai);
        setBundle(bundle);
      } else {
        // No live provider: these sections return nothing.
        setAiReport(null);
        setBundle(null);
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
        <p>Lisibilité ATS, détection d’AI-slop et recommandations — sans envoyer vos données hors machine.</p>
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

          {cv && (
            <>
              <div className="divider" />
              <div className="grid-3">
                <Stat label="Poste détecté" value={cv.title ?? '—'} />
                <Stat label="Seniorité" value={`${cv.seniority} (~${cv.estimatedYearsOfExperience} ans)`} />
                <Stat label="Compétences" value={String(cv.skills.length)} />
              </div>
              {cv.skills.length > 0 && (
                <div className="job-meta" style={{ marginTop: 14 }}>
                  {cv.skills.slice(0, 16).map((s) => (
                    <span key={s} className="badge">{s}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {aiReport && <AiPanel report={aiReport} />}
        {ats && <AtsPanel report={ats} />}
        {slop && <SlopPanel report={slop} />}
        {bundle && <SampleCvPanel bundle={bundle} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function AiPanel({ report }: { report: CvAiReport }) {
  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div>
          <div className="card-title">Analyse IA</div>
          <div className="card-hint">{report.verdict}</div>
        </div>
        <span className="badge ok">IA locale</span>
      </div>
      <LabeledList title="Points forts" items={report.strengths} />
      <LabeledList title="À améliorer" items={report.weaknesses} />
      <LabeledList title="Recommandations" items={report.recommendations} />
    </div>
  );
}

function AtsPanel({ report }: { report: AtsReport }) {
  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 14 }}>
        <div>
          <div className="card-title">Lisibilité ATS</div>
          <div className="card-hint">Score agrégé sur {report.perSystem.length} systèmes (populaires + niche).</div>
        </div>
        <div className="big-score">
          <span className="num" style={{ color: report.aggregateScore >= 0.8 ? 'var(--ok)' : report.aggregateScore >= 0.6 ? 'var(--warn)' : 'var(--bad)' }}>
            {(report.aggregateScore * 100).toFixed(0)}
          </span>
          <span className="pct">/100</span>
        </div>
      </div>

      {report.perSystem.map((sys) => (
        <div className="score-row" key={sys.system}>
          <div className="score-label">
            {sys.system}{' '}
            <span className={`badge ${sys.popularity === 'popular' ? '' : 'warn'}`} style={{ marginLeft: 6 }}>
              {sys.popularity === 'popular' ? 'populaire' : 'niche'}
            </span>
          </div>
          <div className="score-track">
            <div className="score-fill" style={{ width: `${sys.overallScore * 100}%` }} />
          </div>
          <div className="score-val">{(sys.overallScore * 100).toFixed(0)}</div>
        </div>
      ))}

      {report.recommendations.length > 0 && (
        <>
          <div className="divider" />
          <div className="card-hint" style={{ marginBottom: 8 }}>Recommandations</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-1)', fontSize: 13 }}>
            {report.recommendations.map((r, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{r}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SlopPanel({ report }: { report: SlopReport }) {
  const verdictClass = report.verdict === 'clean' ? 'ok' : report.verdict === 'mild' ? 'warn' : 'bad';
  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 10 }}>
        <div>
          <div className="card-title">Détection d’AI-slop</div>
          <div className="card-hint">{report.summary}</div>
        </div>
        <span className={`badge ${verdictClass}`}>
          {report.verdict === 'clean' ? 'Propre' : report.verdict === 'mild' ? 'Léger' : 'Slop'} · {(report.slopScore * 100).toFixed(0)}%
        </span>
      </div>

      {report.findings.length === 0 ? (
        <div className="empty" style={{ padding: '20px' }}>Aucun marqueur d’IA détecté. Votre CV sonne humain et concret.</div>
      ) : (
        report.findings.map((f) => (
          <div className="finding" key={f.id}>
            <span className={`sev ${f.severity}`} />
            <div>
              <span className="term">« {f.term} »</span>
              <span className="muted"> ×{f.count}</span>
              <div className="sugg">{f.suggestion}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------- sample CVs by level ------------------------ */

const SAMPLE_LEVELS: SampleLevel[] = ['junior', 'mid', 'senior'];

const LEVEL_TAB_LABEL: Record<SampleLevel, string> = {
  junior: 'Junior',
  mid: 'Intermédiaire',
  senior: 'Senior'
};

const VERDICT_LABEL: Record<'below' | 'at' | 'above', string> = {
  below: 'En dessous',
  at: 'Au niveau',
  above: 'Au-dessus'
};

/** Map the detected band to the closest reference level (lead → senior). */
function mapToSampleLevel(band: SeniorityBand): SampleLevel {
  return band === 'lead' ? 'senior' : band;
}

function SampleCvPanel({ bundle }: { bundle: SampleCvBundle }) {
  const [level, setLevel] = useState<SampleLevel>(mapToSampleLevel(bundle.userSeniority));
  const sample = bundle.samples.find((s) => s.level === level)!;
  const comp = bundle.comparisons.find((c) => c.level === level)!;

  const verdictClass = comp.verdict === 'below' ? 'warn' : 'ok';
  const fitColor = comp.fitScore >= 0.8 ? 'var(--ok)' : comp.fitScore >= 0.5 ? 'var(--warn)' : 'var(--bad)';

  return (
    <div className="card">
      <div style={{ marginBottom: 14 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>CV d'exemple par niveau</div>
        <div className="card-hint" style={{ marginBottom: 0 }}>
          Même métier : <strong style={{ color: 'var(--text-1)' }}>{bundle.jobFamily}</strong>
          {bundle.userTitle ? ` · Votre poste : ${bundle.userTitle}` : ''}. Comparez votre CV à des références junior, intermédiaire et senior du même domaine.
        </div>
      </div>

      <div className="level-tabs">
        {SAMPLE_LEVELS.map((l) => (
          <button key={l} className={`level-tab ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
            {LEVEL_TAB_LABEL[l]}
          </button>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        {/* Left — the reference CV for this level */}
        <div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{sample.title}</div>
            <span className="badge">{sample.yearsLabel}</span>
          </div>
          <pre className="cv-preview">{sample.rawText}</pre>
        </div>

        {/* Right — how the user's CV compares to this level */}
        <div>
          <div className="row spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Votre CV vs ce niveau</div>
              <span className={`badge ${verdictClass}`}>{VERDICT_LABEL[comp.verdict]}</span>
            </div>
            <div className="big-score">
              <span className="num" style={{ color: fitColor, fontSize: 30 }}>{(comp.fitScore * 100).toFixed(0)}</span>
              <span className="pct">/100</span>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Compétences du métier à ce niveau</div>
            <div className="job-meta">
              {comp.skillCoverage.present.map((s) => (
                <span key={s} className="badge ok">{s}</span>
              ))}
              {comp.skillCoverage.missing.map((s) => (
                <span key={s} className="badge warn">{s}</span>
              ))}
            </div>
          </div>

          {comp.dimensions.map((d) => (
            <div className="score-row" key={d.id}>
              <div className="score-label">{d.label}</div>
              <div className="score-track">
                <div className="score-fill" style={{ width: `${d.score * 100}%` }} />
              </div>
              <div className="score-val">{(d.score * 100).toFixed(0)}</div>
            </div>
          ))}

          <div className="divider" />
          <LabeledList title="À combler" items={comp.gaps} />
          <LabeledList title="Points forts" items={comp.strengths} />
          <LabeledList title="Prochaines étapes" items={comp.nextSteps} />
        </div>
      </div>
    </div>
  );
}

function LabeledList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-1)', fontSize: 13 }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
