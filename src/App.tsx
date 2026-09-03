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

  function handleCategoryChange(event: ChangeEvent<HTMLInputElement>) {
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
          color: #1d201c;
          background: #f3f1e9;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-synthesis: none;
          text-rendering: optimizeLegibility;
        }

        * { box-sizing: border-box; }
        body { margin: 0; min-width: 320px; min-height: 100vh; }
        button, input, textarea, select { font: inherit; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; }

        .app-shell {
          width: min(1180px, calc(100% - 40px));
          margin: 0 auto;
          padding: 28px 0 80px;
        }

        .masthead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 26px;
        }

        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-mark {
          display: grid;
          place-items: center;
          width: 42px;
          height: 42px;
          border-radius: 14px;
          color: #f9f7ef;
          background: #1f392f;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.06em;
          box-shadow: 0 8px 22px rgba(31, 57, 47, 0.2);
        }

        .brand-name { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
        .brand-subtitle { margin-top: 2px; color: #6e746d; font-size: 12px; }
        .workspace-badge {
          border: 1px solid #d9d6ca;
          border-radius: 999px;
          padding: 7px 11px;
          color: #566057;
          background: rgba(255, 255, 255, 0.6);
          font-size: 11px;
          font-weight: 750;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .hero {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(270px, 0.55fr);
          gap: 24px;
          align-items: end;
          margin: 32px 0 30px;
        }

        .eyebrow {
          margin: 0 0 10px;
          color: #b65031;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        h1, h2, h3, p { margin-top: 0; }
        h1 {
          max-width: 760px;
          margin-bottom: 12px;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(38px, 5.4vw, 68px);
          font-weight: 500;
          line-height: 0.98;
          letter-spacing: -0.048em;
        }

        .hero-copy {
          max-width: 670px;
          margin-bottom: 0;
          color: #656b64;
          font-size: 16px;
          line-height: 1.65;
        }

        .pipeline-map {
          margin: 0;
          padding: 18px;
          border: 1px solid #dcd8cc;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.52);
        }

        .pipeline-map dt {
          margin-bottom: 10px;
          color: #737971;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .pipeline-map dd {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 0;
          font-size: 13px;
          font-weight: 700;
        }

        .pipeline-map dd span:not(.map-arrow) {
          padding: 6px 8px;
          border-radius: 8px;
          color: #24463a;
          background: #dce9df;
        }

        .map-arrow { color: #959990; }

        .panel {
          border: 1px solid #ddd9cd;
          border-radius: 24px;
          background: #fcfbf7;
          box-shadow: 0 18px 54px rgba(52, 54, 46, 0.08);
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 26px 28px 22px;
          border-bottom: 1px solid #ebe8df;
        }

        .step-kicker {
          margin-bottom: 7px;
          color: #a0543d;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .panel-header h2 { margin-bottom: 5px; font-size: 23px; letter-spacing: -0.025em; }
        .section-note { margin-bottom: 0; color: #747970; font-size: 13px; line-height: 1.5; }
        .required-note { color: #8a8e86; font-size: 12px; white-space: nowrap; }

        .form-body { padding: 26px 28px 28px; }
        .form-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(220px, 0.65fr);
          gap: 18px;
        }

        .field { display: flex; flex-direction: column; gap: 8px; }
        .field-wide { grid-column: 1 / -1; }
        .field label, .field-label { color: #383d38; font-size: 13px; font-weight: 750; }
        .field small { color: #858981; font-size: 11px; }

        .field input, .field textarea, .field select {
          width: 100%;
          border: 1px solid #d7d5cb;
          border-radius: 12px;
          outline: none;
          color: #242824;
          background: #fff;
          transition: border-color 140ms ease, box-shadow 140ms ease;
        }

        .field input, .field select { min-height: 46px; padding: 0 13px; }
        .field textarea { min-height: 132px; padding: 13px; line-height: 1.55; resize: vertical; }
        .field input:focus, .field textarea:focus, .field select:focus {
          border-color: #426c5c;
          box-shadow: 0 0 0 3px rgba(66, 108, 92, 0.12);
        }

        .reference-block {
          margin: 28px 0 0;
          padding: 0;
          border: 0;
        }

        .reference-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 13px;
        }

        .reference-heading legend { padding: 0; font-size: 14px; font-weight: 800; }
        .reference-tools { display: flex; align-items: center; gap: 12px; }
        .reference-count { margin: 0; color: #71776f; font-size: 12px; }
        .bulk-upload-control {
          position: relative;
          display: inline-flex;
          align-items: center;
          min-height: 34px;
          border: 1px solid #c9cdc5;
          border-radius: 9px;
          padding: 0 11px;
          color: #344b40;
          background: #eef2ec;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
          transition: border-color 140ms ease, background 140ms ease;
        }

        .bulk-upload-control:hover { border-color: #91a99b; background: #e5eee8; }
        .bulk-upload-control:focus-within {
          outline: 3px solid rgba(66, 108, 92, 0.14);
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
          gap: 10px;
        }

        .reference-card {
          position: relative;
          min-height: 116px;
          padding: 15px;
          border: 1px dashed #c9c8bf;
          border-radius: 14px;
          background: #f8f7f2;
          transition: border-color 140ms ease, background 140ms ease;
        }

        .reference-card.is-ready { border-style: solid; border-color: #9db9aa; background: #f0f6f1; }
        .slot-line { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 20px; }
        .slot-name { color: #4d524c; font-size: 12px; font-weight: 800; }
        .slot-status { color: #8b8f88; font-size: 10px; font-weight: 750; text-transform: uppercase; }
        .is-ready .slot-status { color: #39705a; }
        .reference-file { display: flex; min-width: 0; flex-direction: column; gap: 9px; }
        .reference-file-name {
          overflow: hidden;
          color: #70756e;
          font-size: 11px;
          line-height: 1.3;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .is-ready .reference-file-name { color: #344b40; font-weight: 700; }
        .reference-file-action {
          align-self: flex-start;
          border-radius: 7px;
          padding: 6px 8px;
          color: #304238;
          background: #e6e8e1;
          font-size: 11px;
          font-weight: 700;
        }

        .is-ready .reference-file-action { background: #dce9df; }

        .production-row {
          display: grid;
          grid-template-columns: minmax(210px, 0.55fr) minmax(0, 1.45fr);
          gap: 18px;
          align-items: stretch;
          margin-top: 26px;
          padding-top: 25px;
          border-top: 1px solid #ebe8df;
        }

        .run-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 22px;
          padding: 18px 20px;
          border-radius: 16px;
          color: #f6f5ef;
          background: #1f392f;
        }

        .run-card p { margin-bottom: 3px; font-size: 14px; font-weight: 780; }
        .run-card small { color: #b7c7bf; font-size: 11px; }
        .primary-button, .copy-master {
          border: 0;
          border-radius: 11px;
          font-weight: 800;
          transition: transform 140ms ease, opacity 140ms ease;
        }

        .primary-button {
          min-width: 178px;
          padding: 13px 18px;
          color: #243129;
          background: #f5c65c;
        }

        .primary-button:not(:disabled):hover, .copy-master:hover { transform: translateY(-1px); }
        .primary-button:disabled { opacity: 0.45; }

        .advanced-controls { margin-top: 16px; color: #6c716b; font-size: 12px; }
        .advanced-controls summary { cursor: pointer; font-weight: 700; }
        .advanced-controls button, .secondary-button {
          margin-top: 12px;
          border: 1px solid #d3d2c9;
          border-radius: 9px;
          padding: 8px 11px;
          color: #464b46;
          background: #fff;
          font-size: 12px;
          font-weight: 700;
        }

        .alert {
          margin-top: 18px;
          padding: 15px 17px;
          border: 1px solid #e8b8aa;
          border-radius: 13px;
          color: #7d3025;
          background: #fff0eb;
        }

        .alert strong { display: block; margin-bottom: 3px; }
        .alert p { margin-bottom: 0; font-size: 13px; }

        .results { margin-top: 44px; }
        .results-heading {
          display: flex;
          justify-content: space-between;
          align-items: end;
          gap: 20px;
          margin-bottom: 18px;
        }

        .results-heading h2 { margin-bottom: 5px; font-size: 30px; letter-spacing: -0.035em; }
        .result-status {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #347158;
          font-size: 12px;
          font-weight: 800;
        }

        .result-status::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #4c9a74;
          box-shadow: 0 0 0 4px rgba(76, 154, 116, 0.12);
        }

        .scene-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .scene-card {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border: 1px solid #ddd9cf;
          border-radius: 19px;
          background: #fff;
          overflow: hidden;
        }

        .scene-top { display: flex; justify-content: space-between; gap: 16px; padding: 20px 20px 14px; }
        .scene-number {
          margin-bottom: 6px;
          color: #a5543c;
          font-size: 10px;
          font-weight: 850;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .scene-card h3 { margin-bottom: 0; font-size: 21px; letter-spacing: -0.025em; }
        .scene-copy {
          align-self: flex-start;
          border: 1px solid #d7d6ce;
          border-radius: 9px;
          padding: 7px 10px;
          color: #525752;
          background: #f9f8f4;
          font-size: 11px;
          font-weight: 750;
        }

        .metadata {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1px;
          margin: 0;
          border-top: 1px solid #eeece5;
          border-bottom: 1px solid #eeece5;
          background: #eeece5;
        }

        .metadata div { min-width: 0; padding: 11px 13px; background: #f8f7f3; }
        .metadata dt { margin-bottom: 4px; color: #92958f; font-size: 9px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; }
        .metadata dd { margin: 0; overflow: hidden; color: #3d443e; font-size: 11px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
        .metadata .dialogue { grid-column: 1 / -1; }
        .metadata .dialogue dd { line-height: 1.45; white-space: normal; }

        .prompt-block { display: flex; flex: 1; flex-direction: column; padding: 17px 20px 20px; }
        .prompt-heading { display: flex; justify-content: space-between; gap: 12px; color: #7a7e77; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
        .prompt-block pre, .json-preview pre, .inspection pre {
          margin: 11px 0 0;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 11px;
          line-height: 1.65;
        }

        .prompt-block pre { max-height: 330px; color: #3d443e; }
        .handoff {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 22px;
          align-items: center;
          margin-top: 18px;
          padding: 22px;
          border-radius: 18px;
          color: #f7f5ee;
          background: #1e2924;
          box-shadow: 0 16px 42px rgba(30, 41, 36, 0.18);
        }

        .handoff h3 { margin-bottom: 5px; font-size: 19px; }
        .handoff p { margin-bottom: 0; color: #aebbb4; font-size: 12px; line-height: 1.5; }
        .copy-master { padding: 14px 20px; color: #243129; background: #f5c65c; }
        .copy-status { margin: 12px 2px 0; color: #367059; font-size: 12px; font-weight: 750; }

        .json-preview, .inspection {
          margin-top: 14px;
          border: 1px solid #dcd9cf;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.55);
        }

        .json-preview summary, .inspection summary {
          padding: 13px 15px;
          cursor: pointer;
          color: #60665f;
          font-size: 12px;
          font-weight: 750;
        }

        .json-preview pre, .inspection pre {
          max-height: 420px;
          margin: 0;
          padding: 0 15px 15px;
          color: #525852;
        }

        .inspection-area { margin-top: 32px; }
        .inspection-area h2 { margin-bottom: 5px; font-size: 17px; }
        .inspection-action { padding: 0 15px 15px; }

        @media (max-width: 900px) {
          .hero, .production-row { grid-template-columns: 1fr; }
          .reference-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .run-card { min-height: 106px; }
        }

        @media (max-width: 680px) {
          .app-shell { width: min(100% - 24px, 1180px); padding-top: 18px; }
          .masthead { margin-bottom: 18px; }
          .workspace-badge { display: none; }
          .hero { margin-top: 22px; }
          .pipeline-map { display: none; }
          .form-grid, .scene-grid { grid-template-columns: 1fr; }
          .field-wide { grid-column: auto; }
          .panel-header, .form-body { padding-left: 18px; padding-right: 18px; }
          .reference-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .reference-heading { align-items: flex-start; flex-direction: column; gap: 5px; }
          .reference-tools { align-items: flex-start; flex-direction: column; gap: 7px; }
          .run-card, .handoff { grid-template-columns: 1fr; align-items: stretch; }
          .run-card { flex-direction: column; align-items: stretch; }
          .primary-button, .copy-master { width: 100%; }
          .results-heading { align-items: flex-start; flex-direction: column; }
          .metadata { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `}</style>

      <main className="app-shell">
        <header className="masthead">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">M</div>
            <div>
              <div className="brand-name">Mochi Prompt</div>
              <div className="brand-subtitle">Production prompt workspace</div>
            </div>
          </div>
          <div className="workspace-badge">Master UI · V2</div>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">Product story, compiled</p>
            <h1>Build four production-ready scenes.</h1>
            <p className="hero-copy">
              Add the product evidence once. Mochi carries it through evidence analysis,
              scene direction and final prompt compilation without breaking the chain.
            </p>
          </div>
          <dl className="pipeline-map" aria-label="Mochi Prompt pipeline">
            <dt>Production pipeline</dt>
            <dd>
              <span>E1 Evidence</span><span className="map-arrow">→</span>
              <span>E2 Director</span><span className="map-arrow">→</span>
              <span>E3 Compiler</span>
            </dd>
          </dl>
        </section>

        <form className="panel" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <div className="step-kicker">01 · Production input</div>
              <h2>Tell Mochi what you are making</h2>
              <p className="section-note">Product context and visual references stay bound through all four scenes.</p>
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
                <input
                  id="category"
                  type="text"
                  value={category}
                  onChange={handleCategoryChange}
                  placeholder="e.g. Toys"
                  required
                />
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
                      <span className="slot-status">{references[slot] ? 'Ready' : 'Empty'}</span>
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

              <div className="run-card">
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
                <h2>Your four-scene set</h2>
                <p className="section-note">Final prompts and their production inspection metadata.</p>
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
                <h3>Send the complete contract to Mochi Scenes V4</h3>
                <p>Copies every scene, reference route and metadata field exactly as compiled.</p>
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
