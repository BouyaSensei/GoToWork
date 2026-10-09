# GoToWork

**Copilote desktop de recherche d'emploi.** Une application de bureau (Electron) qui analyse votre CV, le note contre les ATS populaires et niche, détecte le style « AI-slop », puis recherche des offres compatibles avec votre profil — en respectant strictement votre séniorité — et peut candidater automatiquement. Propulsé par une **IA locale** (Ollama, LM Studio, ou n'importe quel endpoint OpenAI-compatible).

> Pas de navigateur. Un `.exe` Windows d'abord, Linux ensuite. Interface sobre, accents cyan, zéro décoration « AI-slop ».

---

## Fonctionnalités

- **Analyse de CV** (PDF / DOCX) — extraction des contacts, sections, skills, estimation de l'expérience et de la séniorité.
- **Scoring ATS** déterministe pour 8 systèmes : Workday, Greenhouse, Lever, iCIMS, SuccessFactors, SmartRecruiters, BambooHR, Taleo. Score agrégé + points faibles + recommandations actionnables.
- **Détection AI-slop** — lexique EN/FR (buzzwords, pléonasmes, formules creuses) avec sévérités et suggestions de réécriture.
- **Matching d'offres sensible à la séniorité** — un CV junior n'est **jamais** marqué éligible à l'auto-candidature sur une offre senior/lead, quel que soit le mode.
- **3 modes de recherche** :
  - `basic` — recommandations uniquement, aucune candidature.
  - `hybrid` — s'arrête au lien de postuler et demande votre validation.
  - `total` — enchaîne jusqu'à la candidature des offres éligibles.
- **Chatbot local** — posez des questions sur vos résultats, l'avancée de la recherche, ou demandez conseil.
- **Profil persistant** avec champs prédefinis (LinkedIn, téléphone, email, portfolio, lettre de motivation) pour compléter les formulaires à 100 %.

### Choix assumés
- **Pas de scraping Indeed/LinkedIn** : sites protégés et contraires aux ToS. La source principale est la saisie manuelle (coller des offres), avec des sources RSS/API optionnelles.
- **Moteurs déterministes d'abord** : ATS, slop et matching sont rule-based et testables sans IA ; l'IA enrichit ensuite (chatbot, scoring fin).

---

## Stack

| Couche | Technologie |
| --- | --- |
| Desktop | Electron 31 |
| UI | React 18 + TypeScript |
| Build renderer | Vite 5 |
| Backend main | Node.js (CommonJS) |
| IA locale | Client OpenAI-compatible via `fetch` (sans SDK) |
| Parsing CV | `pdf-parse`, `mammoth` |
| Packaging | electron-builder (NSIS / AppImage+deb) |

---

## Démarrage

Prérequis : **Node.js ≥ 18** et, pour l'IA locale, un serveur (Ollama / LM Studio) en marche.

```bash
npm install
npm run dev        # lance le renderer (Vite) + Electron en mode développement
```

### Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Dev : Vite + Electron ensemble |
| `npm run typecheck` | Type-check des 3 contextes (renderer, main, preload) |
| `npm test` | Compile puis exécute la suite de tests unitaires |
| `npm run build` | Build production (main + renderer + preload) |
| `npm run dist:win` | Installeur Windows (NSIS) dans `release/` |
| `npm run dist:linux` | AppImage + deb Linux dans `release/` |
| `npm run icons` | Régénère les icônes de marque (`build/icon.png`, `.ico`) |

---

## Configuration de l'IA locale

Dans la vue **Réglages**, ajoutez un provider :

- **Ollama** → base URL `http://127.0.0.1:11434/v1`
- **LM Studio** → base URL `http://localhost:1234/v1`
- **OpenAI-compatible** → n'importe quel endpoint exposant `/chat/completions`

Le client parle directement au format OpenAI Chat Completions via `fetch`, sans dépendance à un SDK : les trois sont interchangeables. Testez la connexion avec « Tester la connexion » avant d'enregistrer.

---

## Architecture

```
src/
├─ shared/          Types domaine + contrat IPC (source unique de vérité)
│  ├─ types.ts         CV, ATS, slop, offres, matching, search run, profil, chat
│  ├─ ipc.ts           Canaux IPC + interface GoToWorkApi
│  └─ manualPostings.ts Parseur d'offres collées (partagé main/renderer)
├─ main/            Process principal (Node)
│  ├─ index.ts         Entrée Electron : fenêtre, handlers IPC, dialogues
│  ├─ service.ts       AppService : orchestration store + provider + chatbot + runs
│  ├─ store.ts         Persistance JSON dans userData
│  ├─ ai/
│  │  ├─ provider.ts   LocalAIProvider (OpenAI-compatible) + ProviderError
│  │  └─ chatbot.ts    Chatbot contextuel, historique borné
│  ├─ cv/
│  │  ├─ parser.ts     Parseur PDF/DOCX heuristique
│  │  ├─ ats.ts        Moteur ATS (8 systèmes, checks pondérés)
│  │  └─ slop.ts       Détecteur AI-slop EN/FR
│  └─ search/
│     ├─ matcher.ts    Matching CV/offres + gating séniorité
│     ├─ runManager.ts Machine à états des runs (basic/hybrid/total)
│     └─ sources.ts    JobSource, Manual/RSS sources
├─ preload/index.ts   Bridge contextBridge → window.gotowork
└─ renderer/          UI React (thème sombre/cyan, sans AI-slop)
   ├─ App.tsx          Shell + navigation 4 vues
   └─ views/           CvAnalysis, JobSearch, ChatbotView, Settings
```

### Garde-fou séniorité
`SENIORITY_ORDER = { junior: 0, mid: 1, senior: 2, lead: 3 }` et `AUTO_APPLY_MAX_GAP = 1`. Le matching ne marque une offre **éligible à l'auto-candidature** que si l'écart de séniorité est ≤ 1 **et** selon le mode. C'est verrouillé par des tests unitaires dédiés.

---

## Tests

La logique métier (ATS, slop, matching, provider, run manager, parseur d'offres) est couverte par des tests unitaires Node purs — sans Electron ni réseau :

```bash
npm test
```

---

## CI / Packaging

Un workflow GitHub Actions (`ci.yml`) exécute `typecheck` + `test` sur chaque push/PR et produit l'installeur Windows (NSIS) comme artefact. Le packaging Linux est disponible via `dist:linux`.

---

## Licence

MIT — Axel Pierre.
