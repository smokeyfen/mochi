import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import type {
  CompiledPromptSetV2,
  EvidenceInputV2,
  EvidencePackageV2,
  EvidenceReferenceInputV2,
  ReferenceSlot,
  ScenePlanSetV2,
  VoiceGender,
} from './v2/contracts';

const REFERENCE_SLOTS: readonly ReferenceSlot[] = [1, 2, 3, 4, 5];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the selected image.'));
        return;
      }

      const commaIndex = reader.result.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error('Could not decode the selected image.'));
        return;
      }

      resolve(reader.result.slice(commaIndex + 1));
    });

    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Could not read the selected image.'));
    });

    reader.readAsDataURL(file);
  });
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fallback;
  }

  const value = payload as Record<string, unknown>;
  const message =
    typeof value.message === 'string' && value.message.trim() !== ''
      ? value.message
      : fallback;
  const issues = Array.isArray(value.issues)
    ? value.issues.filter((issue): issue is string => typeof issue === 'string')
    : [];

  return issues.length > 0 ? `${message} ${issues.join(' | ')}` : message;
}

export default function App() {
  const [productName, setProductName] = useState('');
  const [productDetails, setProductDetails] = useState('');
  const [category, setCategory] = useState('');
  const [voiceGender, setVoiceGender] = useState<VoiceGender | ''>('');
  const [references, setReferences] = useState<
    Partial<Record<ReferenceSlot, EvidenceReferenceInputV2>>
  >({});
  const [referenceFileNames, setReferenceFileNames] = useState<
    Partial<Record<ReferenceSlot, string>>
  >({});
  const [pendingFileReads, setPendingFileReads] = useState(0);
  const [evidence, setEvidence] = useState<EvidencePackageV2 | null>(null);
  const [scenePlan, setScenePlan] = useState<ScenePlanSetV2 | null>(null);
  const [compiledPrompts, setCompiledPrompts] = useState<CompiledPromptSetV2 | null>(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);

  const selectedReferences = REFERENCE_SLOTS.flatMap((slot) => {
    const reference = references[slot];
    return reference ? [reference] : [];
  });

  const inputReady =
    productName.trim() !== '' &&
    productDetails.trim() !== '' &&
    category.trim() !== '' &&
    voiceGender !== '' &&
    selectedReferences.length >= 1 &&
    pendingFileReads === 0;

  const canSubmit = inputReady && !isSubmitting && !isRunningPipeline;
  const canRunPipeline =
    inputReady &&
    !isSubmitting &&
    !isPlanning &&
    !isCompiling &&
    !isRunningPipeline;

  function handleProductNameChange(event: ChangeEvent<HTMLInputElement>) {
    setProductName(event.currentTarget.value);
  }

  function handleProductDetailsChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setProductDetails(event.currentTarget.value);
  }

  function handleCategoryChange(event: ChangeEvent<HTMLSelectElement>) {
    setCategory(event.currentTarget.value);
  }

  function handleVoiceGenderChange(event: ChangeEvent<HTMLSelectElement>) {
    setVoiceGender(event.currentTarget.value as VoiceGender | '');
  }

  async function handleReferenceChange(event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const slotValue = Number(inputElement.dataset.slot);
    if (!REFERENCE_SLOTS.includes(slotValue as ReferenceSlot)) {
      setError('Reference slot is invalid.');
      return;
    }

    const slot = slotValue as ReferenceSlot;
    const file = inputElement.files?.[0];

    if (!file) {
      setReferences((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      setReferenceFileNames((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      return;
    }

    if (!file.type.startsWith('image/')) {
      inputElement.value = '';
      setReferences((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      setReferenceFileNames((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      setError(`Reference slot ${slot} must contain an image.`);
      return;
    }

    setError('');
    setPendingFileReads((count) => count + 1);

    try {
      const dataBase64 = await fileToBase64(file);
      setReferences((current) => ({
        ...current,
        [slot]: {
          slot,
          mimeType: file.type,
          dataBase64,
        },
      }));
      setReferenceFileNames((current) => ({
        ...current,
        [slot]: file.name,
      }));
    } catch (readError) {
      inputElement.value = '';
      setReferences((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      setReferenceFileNames((current) => {
        const next = { ...current };
        delete next[slot];
        return next;
      });
      setError(
        readError instanceof Error
          ? readError.message
          : `Could not read reference slot ${slot}.`,
      );
    } finally {
      setPendingFileReads((count) => Math.max(0, count - 1));
    }
  }

  async function handleBulkReferenceChange(event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const files = Array.from(inputElement.files ?? []);

    if (files.length === 0) return;

    if (files.length > REFERENCE_SLOTS.length) {
      inputElement.value = '';
      setError('Upload up to 5 images at once. Existing references were not changed.');
      return;
    }

    if (files.some((file) => !file.type.startsWith('image/'))) {
      inputElement.value = '';
      setError('Bulk upload accepts image files only. Existing references were not changed.');
      return;
    }

    setError('');
    setPendingFileReads((count) => count + files.length);

    try {
      const loadedReferences = await Promise.all(
        files.map(async (file, index): Promise<EvidenceReferenceInputV2> => ({
          slot: REFERENCE_SLOTS[index],
          mimeType: file.type,
          dataBase64: await fileToBase64(file),
        })),
      );

      setReferences((current) => {
        const next = { ...current };
        loadedReferences.forEach((reference) => {
          next[reference.slot] = reference;
        });
        return next;
      });
      setReferenceFileNames((current) => {
        const next = { ...current };
        files.forEach((file, index) => {
          next[REFERENCE_SLOTS[index]] = file.name;
        });
        return next;
      });
    } catch (readError) {
      setError(
        readError instanceof Error
          ? `${readError.message} Existing references were not changed.`
          : 'Could not read the selected images. Existing references were not changed.',
      );
    } finally {
      inputElement.value = '';
      setPendingFileReads((count) => Math.max(0, count - files.length));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const input: EvidenceInputV2 = {
      productName,
      productDetails,
      category,
      voiceGender,
      references: selectedReferences,
    };

    setError('');
    setCopyStatus('');
    setEvidence(null);
    setScenePlan(null);
    setCompiledPrompts(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/v2/evidence/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Evidence analysis failed with HTTP ${response.status}.`),
        );
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Evidence API returned an invalid response.');
      }

      const result = payload as { evidence?: EvidencePackageV2 };
      if (!result.evidence) {
        throw new Error('Evidence API returned no evidence package.');
      }

      setEvidence(result.evidence);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Evidence analysis failed.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePlanScenes() {
    if (!evidence || isPlanning) return;

    setError('');
    setCopyStatus('');
    setScenePlan(null);
    setCompiledPrompts(null);
    setIsPlanning(true);

    try {
      const response = await fetch('/api/v2/director/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ evidence }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Scene planning failed with HTTP ${response.status}.`),
        );
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Director API returned an invalid response.');
      }

      const result = payload as { scenePlan?: ScenePlanSetV2 };
      if (!result.scenePlan) {
        throw new Error('Director API returned no scene plan.');
      }

      setScenePlan(result.scenePlan);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Scene planning failed.',
      );
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleCompilePrompts() {
    if (!evidence || !scenePlan || isCompiling) return;

    setError('');
    setCopyStatus('');
    setCompiledPrompts(null);
    setIsCompiling(true);

    try {
      const response = await fetch('/api/v2/compiler/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ evidence, scenePlan }),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Prompt compilation failed with HTTP ${response.status}.`),
        );
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Compiler API returned an invalid response.');
      }

      const result = payload as { compiledPrompts?: CompiledPromptSetV2 };
      if (!result.compiledPrompts) {
        throw new Error('Compiler API returned no compiled prompts.');
      }

      setCompiledPrompts(result.compiledPrompts);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Prompt compilation failed.',
      );
    } finally {
      setIsCompiling(false);
    }
  }

  async function handleRunPipeline() {
    if (!canRunPipeline) return;

    const input: EvidenceInputV2 = {
      productName,
      productDetails,
      category,
      voiceGender,
      references: selectedReferences,
    };

    setError('');
    setCopyStatus('');
    setEvidence(null);
    setScenePlan(null);
    setCompiledPrompts(null);
    setIsRunningPipeline(true);

    try {
      const response = await fetch('/api/v2/pipeline/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, `Pipeline failed with HTTP ${response.status}.`),
        );
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Pipeline API returned an invalid response.');
      }

      const result = payload as {
        evidence?: EvidencePackageV2;
        scenePlan?: ScenePlanSetV2;
        compiledPrompts?: CompiledPromptSetV2;
      };

      if (!result.evidence || !result.scenePlan || !result.compiledPrompts) {
        throw new Error('Pipeline API returned an incomplete result.');
      }

      setEvidence(result.evidence);
      setScenePlan(result.scenePlan);
      setCompiledPrompts(result.compiledPrompts);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Pipeline failed.',
      );
    } finally {
      setIsRunningPipeline(false);
    }
  }

  async function copyPrompt(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
      setError('');
    } catch {
      setError('Could not copy the prompt to the clipboard.');
    }
  }

  async function handleCopyAllPrompts() {
    if (!compiledPrompts) return;

    await copyPrompt(
      JSON.stringify(compiledPrompts, null, 2),
      'CompiledPromptSetV2 copied.',
    );
  }

  return (
    <>
      <style>{`
        :root {
          color: #dce3e8;
          background: #0d1013;
          font-family: "Segoe UI", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
          color-scheme: dark;
        }

        * { box-sizing: border-box; }
        body {
          margin: 0;
          min-width: 320px;
          min-height: 100vh;
          background:
            linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
            #0d1013;
          background-size: 32px 32px;
        }
        button, input, textarea, select { font: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; }
        ::selection { color: #f4f7ff; background: #6257c8; }

        .app-shell {
          width: min(1240px, calc(100% - 32px));
          margin: 0 auto;
          padding: 18px 0 52px;
        }

        .masthead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          min-height: 58px;
          margin-bottom: 14px;
          padding: 0 2px 14px;
          border-bottom: 1px solid #293038;
        }

        .brand { display: flex; align-items: center; gap: 11px; }
        .brand-mark {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          border: 1px solid #3b4650;
          border-radius: 6px;
          color: #8fa9ff;
          background: #171c22;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: -0.04em;
          box-shadow: inset 0 0 0 1px rgba(143, 169, 255, 0.05);
        }

        .brand-name {
          color: #f0f3f5;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }
        .brand-subtitle {
          margin-top: 3px;
          color: #7f8a94;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.16em;
        }
        .workspace-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #303841;
          border-radius: 4px;
          padding: 7px 10px;
          color: #8b96a0;
          background: #15191e;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .workspace-badge::before {
          content: "";
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #59636d;
        }

        .workspace-badge.is-ready { color: #70d69b; border-color: rgba(82, 209, 138, 0.35); }
        .workspace-badge.is-ready::before { background: #52d18a; animation: ready-pulse 1.7s ease-out 3; }
        .workspace-badge.is-running { color: #62d8f2; border-color: rgba(68, 199, 231, 0.4); }
        .workspace-badge.is-running::before { background: #44c7e7; animation: processing-pulse 900ms ease-in-out infinite; }
        .workspace-badge.is-error { color: #f0807d; border-color: rgba(239, 106, 104, 0.4); }
        .workspace-badge.is-error::before { background: #ef6a68; }

        .hero {
          display: grid;
          grid-template-columns: minmax(260px, 0.65fr) minmax(520px, 1.35fr);
          gap: 14px;
          align-items: stretch;
          margin: 0 0 14px;
        }

        .eyebrow {
          margin: 0 0 7px;
          color: #71808c;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        h1, h2, h3, p { margin-top: 0; }
        h1 {
          margin-bottom: 7px;
          color: #eef2f5;
          font-size: clamp(22px, 2.4vw, 30px);
          font-weight: 750;
          line-height: 1.1;
          letter-spacing: -0.025em;
        }

        .hero-copy {
          max-width: 560px;
          margin-bottom: 0;
          color: #88939c;
          font-size: 12px;
          line-height: 1.55;
        }

        .hero > div:first-child,
        .pipeline-map {
          margin: 0;
          padding: 16px 18px;
          border: 1px solid #293139;
          border-radius: 7px;
          background: #14181d;
        }

        .pipeline-map dt {
          margin-bottom: 9px;
          color: #71808b;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .pipeline-map dd {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
          margin: 0;
        }

        .pipeline-stage {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 2px 8px;
          align-items: center;
          min-width: 0;
          padding: 9px 10px;
          border: 1px solid #2a323a;
          border-radius: 5px;
          background: #191e24;
        }

        .status-dot {
          grid-row: 1 / 3;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #59636d;
        }

        .stage-label {
          overflow: hidden;
          color: #cbd2d8;
          font-size: 11px;
          font-weight: 700;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .stage-label strong {
          margin-right: 5px;
          color: #8fa9ff;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
        }

        .stage-state {
          color: #67737d;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.1em;
        }

        .pipeline-stage.is-ready { border-color: rgba(82, 209, 138, 0.32); }
        .pipeline-stage.is-ready .status-dot { background: #52d18a; animation: ready-pulse 1.7s ease-out 3; }
        .pipeline-stage.is-ready .stage-state { color: #62cb8e; }
        .pipeline-stage.is-running { border-color: rgba(68, 199, 231, 0.38); background: #172127; }
        .pipeline-stage.is-running .status-dot { background: #44c7e7; animation: processing-pulse 900ms ease-in-out infinite; }
        .pipeline-stage.is-running .stage-state { color: #59cce8; }

        .panel {
          border: 1px solid #303840;
          border-radius: 8px;
          background: #171b20;
          box-shadow: 0 16px 38px rgba(0, 0, 0, 0.22);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 15px 18px 13px;
          border-bottom: 1px solid #2a3138;
          background: #1c2127;
        }

        .step-kicker {
          margin-bottom: 5px;
          color: #8fa9ff;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .panel-header h2 { margin-bottom: 3px; color: #e2e7eb; font-size: 16px; letter-spacing: -0.01em; }
        .section-note { margin-bottom: 0; color: #7f8b95; font-size: 11px; line-height: 1.5; }
        .required-note {
          border: 1px solid rgba(232, 183, 89, 0.28);
          border-radius: 4px;
          padding: 5px 7px;
          color: #d8aa50;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .form-body { padding: 16px 18px 18px; }
        .form-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(220px, 0.65fr);
          gap: 12px;
        }

        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-wide { grid-column: 1 / -1; }
        .field label, .field-label {
          color: #aab4bc;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .field small { color: #6f7b85; font-size: 10px; }

        .field input, .field textarea, .field select {
          width: 100%;
          border: 1px solid #333c45;
          border-radius: 5px;
          outline: none;
          color: #dce3e8;
          background: #11151a;
          transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
        }

        .field input::placeholder, .field textarea::placeholder { color: #58636d; }
        .field input, .field select { min-height: 38px; padding: 0 10px; }
        .field textarea { min-height: 104px; padding: 10px; line-height: 1.5; resize: vertical; }
        .field input:focus, .field textarea:focus, .field select:focus {
          border-color: #6684e8;
          background: #141920;
          box-shadow: 0 0 0 2px rgba(102, 132, 232, 0.16);
        }

        .reference-block {
          margin: 18px 0 0;
          padding: 0;
          border: 0;
        }

        .reference-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 14px;
          margin-bottom: 9px;
        }

        .reference-heading legend {
          padding: 0;
          color: #aab4bc;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }
        .reference-tools { display: flex; align-items: center; gap: 10px; }
        .reference-count {
          margin: 0;
          color: #77838d;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
        }
        .bulk-upload-control {
          position: relative;
          display: inline-flex;
          align-items: center;
          min-height: 30px;
          border: 1px solid #3b4650;
          border-radius: 4px;
          padding: 0 9px;
          color: #aeb9c2;
          background: #20262d;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 100ms ease;
        }

        .bulk-upload-control:hover { border-color: #6684e8; color: #d7e0ff; background: #252d36; }
        .bulk-upload-control:active { transform: translateY(1px); }
        .bulk-upload-control:focus-within {
          outline: 2px solid rgba(102, 132, 232, 0.2);
          outline-offset: 1px;
        }

        .bulk-upload-input, .reference-file-input {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
        }

        .reference-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 7px;
        }

        .reference-card {
          position: relative;
          min-height: 104px;
          padding: 11px;
          border: 1px dashed #38414a;
          border-radius: 5px;
          background: #14191e;
          cursor: pointer;
          transition: border-color 140ms ease, background 140ms ease, transform 100ms ease;
        }

        .reference-card:hover { border-color: #56636f; background: #191f25; }
        .reference-card:active { transform: translateY(1px); }
        .reference-card.is-ready {
          border-style: solid;
          border-color: rgba(125, 105, 238, 0.68);
          background: #1a1b2a;
          box-shadow: inset 0 0 0 1px rgba(125, 105, 238, 0.08);
        }
        .slot-line { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 15px; }
        .slot-name {
          color: #aab4bd;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .slot-status {
          color: #68747e;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .is-ready .slot-status { color: #9d91ff; }
        .reference-file { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
        .reference-file-name {
          overflow: hidden;
          color: #707c86;
          font-size: 10px;
          line-height: 1.3;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .is-ready .reference-file-name { color: #d2d6e8; font-weight: 700; }
        .reference-file-action {
          align-self: flex-start;
          border: 1px solid #35404a;
          border-radius: 3px;
          padding: 4px 6px;
          color: #9ba7b0;
          background: #20262d;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .is-ready .reference-file-action { border-color: #50479b; color: #b6adff; background: #25213d; }

        .production-row {
          display: grid;
          grid-template-columns: minmax(210px, 0.55fr) minmax(0, 1.45fr);
          gap: 12px;
          align-items: stretch;
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid #2a3138;
        }

        .run-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 12px 14px;
          border: 1px solid #37424c;
          border-radius: 5px;
          color: #e5ebef;
          background: #20262c;
        }

        .run-card.is-running { border-color: rgba(68, 199, 231, 0.48); background: #18252b; }
        .run-card p {
          margin-bottom: 3px;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .run-card small { color: #788590; font-size: 10px; }
        .primary-button, .copy-master {
          border: 1px solid #6f65cf;
          border-radius: 4px;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          transition: border-color 140ms ease, background 140ms ease, transform 100ms ease, opacity 140ms ease;
        }

        .primary-button {
          min-width: 168px;
          padding: 11px 14px;
          color: #f1efff;
          background: #544bb2;
        }

        .primary-button:not(:disabled):hover, .copy-master:hover { border-color: #9d91ff; background: #6257c8; }
        .primary-button:not(:disabled):active, .copy-master:active { transform: translateY(1px); }
        .primary-button:disabled { border-color: #343b43; color: #66717a; background: #252a30; opacity: 0.65; }

        .advanced-controls { margin-top: 11px; color: #707c86; font-size: 10px; }
        .advanced-controls summary { cursor: pointer; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-weight: 800; }
        .advanced-controls button, .secondary-button {
          margin-top: 9px;
          border: 1px solid #3b4650;
          border-radius: 4px;
          padding: 7px 9px;
          color: #aeb8c0;
          background: #20262c;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 800;
          transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
        }

        .advanced-controls button:hover, .secondary-button:hover { border-color: #61707d; color: #e1e6e9; background: #262d34; }

        .alert {
          margin-top: 12px;
          padding: 12px 14px;
          border: 1px solid rgba(239, 106, 104, 0.48);
          border-radius: 5px;
          color: #f49a97;
          background: #28191c;
        }

        .alert strong { display: block; margin-bottom: 3px; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 10px; text-transform: uppercase; }
        .alert p { margin-bottom: 0; color: #c98381; font-size: 11px; }

        .results { margin-top: 22px; animation: results-in 320ms ease-out both; }
        .results-heading {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 16px;
          margin-bottom: 10px;
        }

        .results-heading h2 { margin-bottom: 3px; color: #e4e9ed; font-size: 18px; letter-spacing: -0.015em; }
        .result-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #6ed69a;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .result-status::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #52d18a;
          box-shadow: 0 0 0 3px rgba(82, 209, 138, 0.1);
          animation: ready-pulse 1.7s ease-out 3;
        }

        .scene-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
        .scene-card {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border: 1px solid #303941;
          border-radius: 6px;
          background: #161b20;
          overflow: hidden;
          animation: module-in 280ms ease-out both;
        }

        .scene-card:nth-child(2) { animation-delay: 45ms; }
        .scene-card:nth-child(3) { animation-delay: 90ms; }
        .scene-card:nth-child(4) { animation-delay: 135ms; }
        .scene-top { display: flex; justify-content: space-between; gap: 14px; padding: 12px 14px 10px; background: #1c2127; }
        .scene-number {
          margin-bottom: 4px;
          color: #8fa9ff;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .scene-card h3 { margin-bottom: 0; color: #e0e5e9; font-size: 14px; letter-spacing: 0.01em; }
        .scene-copy {
          align-self: flex-start;
          border: 1px solid #3c4650;
          border-radius: 4px;
          padding: 6px 8px;
          color: #9da8b1;
          background: #22282e;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 8px;
          font-weight: 900;
          text-transform: uppercase;
          transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 100ms ease;
        }

        .scene-copy:hover { border-color: #6684e8; color: #cbd6ff; background: #252c36; }
        .scene-copy:active { transform: translateY(1px); }

        .metadata {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1px;
          margin: 0;
          border-top: 1px solid #2b333b;
          border-bottom: 1px solid #2b333b;
          background: #2b333b;
        }

        .metadata div { min-width: 0; padding: 8px 10px; background: #171c21; }
        .metadata dt { margin-bottom: 3px; color: #65727c; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 7px; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }
        .metadata dd { margin: 0; overflow: hidden; color: #b9c2c9; font-size: 9px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
        .metadata .dialogue { grid-column: 1 / -1; }
        .metadata .dialogue dd { line-height: 1.45; white-space: normal; }

        .prompt-block { display: flex; flex: 1; flex-direction: column; padding: 10px 13px 13px; }
        .prompt-heading { display: flex; justify-content: space-between; gap: 12px; color: #68757f; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 7px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
        .prompt-block pre, .json-preview pre, .inspection pre {
          margin: 11px 0 0;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 10px;
          line-height: 1.55;
        }

        .prompt-block pre { max-height: 300px; color: #aeb8c0; }
        .handoff {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          margin-top: 10px;
          padding: 15px 16px;
          border: 1px solid rgba(82, 209, 138, 0.35);
          border-radius: 6px;
          color: #e6ece9;
          background: #16211d;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
        }

        .handoff h3 { margin-bottom: 3px; font-size: 14px; }
        .handoff p { margin-bottom: 0; color: #7f9389; font-size: 10px; line-height: 1.5; }
        .copy-master { padding: 11px 15px; color: #f1efff; background: #544bb2; }
        .copy-status { margin: 8px 2px 0; color: #65cf92; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 9px; font-weight: 900; }

        .json-preview, .inspection {
          margin-top: 8px;
          border: 1px solid #2e363e;
          border-radius: 5px;
          background: #14191e;
        }

        .json-preview summary, .inspection summary {
          padding: 10px 12px;
          cursor: pointer;
          color: #85919a;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 9px;
          font-weight: 900;
          transition: color 140ms ease, background 140ms ease;
        }

        .json-preview summary:hover, .inspection summary:hover { color: #b9c2c9; background: #1a2025; }

        .json-preview pre, .inspection pre {
          max-height: 420px;
          margin: 0;
          padding: 0 12px 12px;
          color: #98a4ad;
        }

        .inspection-area { margin-top: 18px; }
        .inspection-area h2 { margin-bottom: 3px; color: #b8c1c8; font-size: 13px; }
        .inspection-action { padding: 0 12px 12px; }

        @keyframes ready-pulse {
          0% { box-shadow: 0 0 0 0 rgba(82, 209, 138, 0.38); }
          70% { box-shadow: 0 0 0 6px rgba(82, 209, 138, 0); }
          100% { box-shadow: 0 0 0 0 rgba(82, 209, 138, 0); }
        }

        @keyframes processing-pulse {
          0%, 100% { opacity: 0.45; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.08); }
        }

        @keyframes results-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes module-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 900px) {
          .hero, .production-row { grid-template-columns: 1fr; }
          .reference-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }

        @media (max-width: 680px) {
          .app-shell { width: min(100% - 18px, 1240px); padding-top: 10px; }
          .masthead { margin-bottom: 10px; }
          .workspace-badge { display: none; }
          .hero { margin-top: 0; }
          .pipeline-map dd { grid-template-columns: 1fr; }
          .form-grid, .scene-grid { grid-template-columns: 1fr; }
          .field-wide { grid-column: auto; }
          .panel-header, .form-body { padding-left: 12px; padding-right: 12px; }
          .reference-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .reference-heading { align-items: flex-start; flex-direction: column; gap: 5px; }
          .reference-tools { align-items: flex-start; flex-direction: column; gap: 7px; }
          .run-card, .handoff { grid-template-columns: 1fr; align-items: stretch; }
          .run-card { flex-direction: column; align-items: stretch; }
          .primary-button, .copy-master { width: 100%; }
          .results-heading { align-items: flex-start; flex-direction: column; }
          .metadata { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            scroll-behavior: auto !important;
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <main className="app-shell">
        <header className="masthead">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">MP</div>
            <div>
              <div className="brand-name">MOCHI PROMPT</div>
              <div className="brand-subtitle">PRODUCTION CONSOLE</div>
            </div>
          </div>
          <div
            className={`workspace-badge${
              error !== ''
                ? ' is-error'
                : isRunningPipeline || isSubmitting || isPlanning || isCompiling
                  ? ' is-running'
                  : compiledPrompts
                    ? ' is-ready'
                    : ''
            }`}
          >
            {error !== ''
              ? 'Error'
              : isRunningPipeline || isSubmitting || isPlanning || isCompiling
                ? 'Running'
                : compiledPrompts
                  ? 'Ready'
                  : 'Console online'}
          </div>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">System / Prompt pipeline</p>
            <h1>Production control</h1>
            <p className="hero-copy">
              Configure product evidence, execute the locked E1–E3 sequence and inspect
              the compiled four-scene output.
            </p>
          </div>
          <dl className="pipeline-map" aria-label="Mochi Prompt pipeline">
            <dt>Pipeline status</dt>
            <dd>
              <span
                className={`pipeline-stage${
                  isRunningPipeline || isSubmitting ? ' is-running' : evidence ? ' is-ready' : ''
                }`}
              >
                <span className="status-dot" />
                <span className="stage-label"><strong>E1</strong>Evidence</span>
                <span className="stage-state">
                  {isRunningPipeline || isSubmitting ? 'RUNNING' : evidence ? 'READY' : 'STANDBY'}
                </span>
              </span>
              <span
                className={`pipeline-stage${
                  isRunningPipeline || isPlanning ? ' is-running' : scenePlan ? ' is-ready' : ''
                }`}
              >
                <span className="status-dot" />
                <span className="stage-label"><strong>E2</strong>Director</span>
                <span className="stage-state">
                  {isRunningPipeline || isPlanning ? 'RUNNING' : scenePlan ? 'READY' : 'STANDBY'}
                </span>
              </span>
              <span
                className={`pipeline-stage${
                  isRunningPipeline || isCompiling ? ' is-running' : compiledPrompts ? ' is-ready' : ''
                }`}
              >
                <span className="status-dot" />
                <span className="stage-label"><strong>E3</strong>Compiler</span>
                <span className="stage-state">
                  {isRunningPipeline || isCompiling ? 'RUNNING' : compiledPrompts ? 'READY' : 'STANDBY'}
                </span>
              </span>
            </dd>
          </dl>
        </section>

        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <div className="step-kicker">01 · Production input</div>
              <h2>Production input configuration</h2>
              <p className="section-note">Product context and references remain bound through all four scenes.</p>
            </div>
            <span className="required-note">All fields required</span>
          </div>

          <div className="form-body">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="product-name">Product name</label>
                <input
                  id="product-name"
                  type="text"
                  value={productName}
                  onChange={handleProductNameChange}
                  placeholder="e.g. Eight-piece pull-back car set"
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="category">Category</label>
                <select
                  id="category"
                  value={category}
                  onChange={handleCategoryChange}
                  required
                >
                  <option value="" disabled>Chọn danh mục</option>
                  <option value="Đồ chơi và Trẻ em">Đồ chơi và Trẻ em</option>
                  <option value="Điện tử tiêu dùng">Điện tử tiêu dùng</option>
                  <option value="Mẹ và Bé">Mẹ và Bé</option>
                  <option value="Trang trí nhà cửa">Trang trí nhà cửa</option>
                  <option value="Thực phẩm và Đồ uống">Thực phẩm và Đồ uống</option>
                </select>
              </div>

              <div className="field field-wide">
                <label htmlFor="product-details">Product details</label>
                <textarea
                  id="product-details"
                  value={productDetails}
                  onChange={handleProductDetailsChange}
                  rows={6}
                  placeholder="Add the facts, features and product claims that should guide the scene set."
                  required
                />
                <small>Use factual source information. E1 will separate evidence from inference.</small>
              </div>
            </div>

            <fieldset className="reference-block">
              <div className="reference-heading">
                <legend>02 · Reference images</legend>
                <div className="reference-tools">
                  <label className="bulk-upload-control" htmlFor="reference-bulk">
                    Upload multiple images
                    <input
                      className="bulk-upload-input"
                      id="reference-bulk"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleBulkReferenceChange}
                    />
                  </label>
                  <p className="reference-count" aria-live="polite">
                    {pendingFileReads > 0
                      ? `Reading ${pendingFileReads} image file(s)…`
                      : `${selectedReferences.length} of 5 slots ready`}
                  </p>
                </div>
              </div>
              <div className="reference-grid">
                {REFERENCE_SLOTS.map((slot) => (
                  <label
                    className={`reference-card${references[slot] ? ' is-ready' : ''}`}
                    htmlFor={`reference-${slot}`}
                    key={slot}
                  >
                    <span className="slot-line">
                      <span className="slot-name">Reference {slot}</span>
                      <span className="slot-status">{references[slot] ? 'Selected' : 'Empty'}</span>
                    </span>
                    <span className="reference-file">
                      <span className="reference-file-name" title={referenceFileNames[slot]}>
                        {references[slot]
                          ? referenceFileNames[slot] ?? 'Selected image'
                          : 'No image selected'}
                      </span>
                      <span className="reference-file-action">
                        {references[slot] ? 'Replace' : 'Choose image'}
                      </span>
                    </span>
                    <input
                      className="reference-file-input"
                      id={`reference-${slot}`}
                      data-slot={slot}
                      type="file"
                      accept="image/*"
                      onChange={handleReferenceChange}
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="production-row">
              <div className="field">
                <label htmlFor="voice-gender">03 · Voice selection</label>
                <select
                  id="voice-gender"
                  value={voiceGender}
                  onChange={handleVoiceGenderChange}
                  required
                >
                  <option value="">Select voice gender</option>
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                </select>
                <small>Preserved in every downstream contract.</small>
              </div>

              <div className={`run-card${isRunningPipeline ? ' is-running' : ''}`}>
                <div>
                  <p>04 · Run Mochi Prompt</p>
                  <small>Evidence → four-scene direction → compiled output</small>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleRunPipeline}
                  disabled={!canRunPipeline}
                >
                  {isRunningPipeline ? 'Building scenes…' : 'Run Mochi Prompt'}
                </button>
              </div>
            </div>

            <details className="advanced-controls">
              <summary>Advanced · run E1 only</summary>
              <button type="submit" disabled={!canSubmit}>
                {isSubmitting ? 'Analyzing evidence…' : 'Analyze evidence only'}
              </button>
            </details>
          </div>
        </form>

        {error !== '' ? (
          <section className="alert" aria-live="assertive">
            <strong>Mochi could not complete this run</strong>
            <p>{error}</p>
          </section>
        ) : null}

        {compiledPrompts ? (
          <section className="results">
            <div className="results-heading">
              <div>
                <div className="step-kicker">05 · Final scenes</div>
                <h2>Scene output modules</h2>
                <p className="section-note">Compiled prompt and inspection metadata for each scene.</p>
              </div>
              <span className="result-status">CompiledPromptSetV2 ready</span>
            </div>

            <div className="scene-grid">
              {compiledPrompts.scenes.map((scene) => (
                <article className="scene-card" key={scene.sceneNumber}>
                  <div className="scene-top">
                    <div>
                      <div className="scene-number">Scene {scene.sceneNumber}</div>
                      <h3>{scene.inspectionMetadata.sceneMode}</h3>
                    </div>
                    <button
                      className="scene-copy"
                      type="button"
                      onClick={() =>
                        copyPrompt(scene.finalPrompt, `Copied Scene ${scene.sceneNumber}.`)
                      }
                    >
                      Copy scene
                    </button>
                  </div>

                  <dl className="metadata">
                    <div>
                      <dt>Product</dt>
                      <dd>{scene.inspectionMetadata.productName}</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>{scene.inspectionMetadata.sceneMode}</dd>
                    </div>
                    <div>
                      <dt>Action</dt>
                      <dd>{scene.inspectionMetadata.action}</dd>
                    </div>
                    <div>
                      <dt>Camera</dt>
                      <dd>{scene.inspectionMetadata.cameraIntent}</dd>
                    </div>
                    <div>
                      <dt>References</dt>
                      <dd>
                        {[
                          scene.primaryReferenceId,
                          ...scene.supportingReferenceIds,
                        ].join(', ')}
                      </dd>
                    </div>
                    <div className="dialogue">
                      <dt>Dialogue</dt>
                      <dd>{scene.inspectionMetadata.dialogue}</dd>
                    </div>
                  </dl>

                  <div className="prompt-block">
                    <div className="prompt-heading">
                      <span>Final prompt</span>
                      <span>{scene.characterCount} characters</span>
                    </div>
                    <pre>{scene.finalPrompt}</pre>
                  </div>
                </article>
              ))}
            </div>

            <div className="handoff">
              <div>
                <div className="scene-number">06 · Production handoff</div>
                <h3>CompiledPromptSetV2 output</h3>
                <p>Complete scene, reference routing and metadata contract for Mochi Scenes V4.</p>
              </div>
              <button className="copy-master" type="button" onClick={handleCopyAllPrompts}>
                Copy CompiledPromptSetV2
              </button>
            </div>
            {copyStatus !== '' ? <p className="copy-status" aria-live="polite">{copyStatus}</p> : null}

            <details className="json-preview">
              <summary>Inspect final CompiledPromptSetV2 output</summary>
              <pre>{JSON.stringify(compiledPrompts, null, 2)}</pre>
            </details>
          </section>
        ) : null}

        {evidence || scenePlan ? (
          <section className="inspection-area">
            <h2>Pipeline inspection</h2>
            <p className="section-note">Intermediate contracts are available here when you need to audit the run.</p>

            {evidence ? (
              <details className="inspection">
                <summary>Inspect EvidencePackageV2</summary>
                <pre>{JSON.stringify(evidence, null, 2)}</pre>
                <div className="inspection-action">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handlePlanScenes}
                    disabled={isPlanning}
                  >
                    {isPlanning ? 'Planning 4 scenes…' : 'Run E2 scene direction only'}
                  </button>
                </div>
              </details>
            ) : null}

            {scenePlan ? (
              <details className="inspection">
                <summary>Inspect ScenePlanSetV2</summary>
                <pre>{JSON.stringify(scenePlan, null, 2)}</pre>
                <div className="inspection-action">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleCompilePrompts}
                    disabled={isCompiling}
                  >
                    {isCompiling ? 'Compiling final prompts…' : 'Run E3 compiler only'}
                  </button>
                </div>
              </details>
            ) : null}
          </section>
        ) : null}
      </main>
    </>
  );
}
