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
  const [pendingFileReads, setPendingFileReads] = useState(0);
  const [evidence, setEvidence] = useState<EvidencePackageV2 | null>(null);
  const [scenePlan, setScenePlan] = useState<ScenePlanSetV2 | null>(null);
  const [compiledPrompts, setCompiledPrompts] = useState<CompiledPromptSetV2 | null>(null);
  const [error, setError] = useState('');
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
      return;
    }

    if (!file.type.startsWith('image/')) {
      inputElement.value = '';
      setReferences((current) => {
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
    } catch (readError) {
      inputElement.value = '';
      setReferences((current) => {
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

  return (
    <main>
      <h1>MOCHI PROMPT V2 - End-to-End Test Surface</h1>
      <p>Run the full E1 to E2 to E3 pipeline or inspect each stage separately.</p>

      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="product-name">Product name</label>
          <br />
          <input
            id="product-name"
            type="text"
            value={productName}
            onChange={handleProductNameChange}
            required
          />
        </p>

        <p>
          <label htmlFor="product-details">Product details</label>
          <br />
          <textarea
            id="product-details"
            value={productDetails}
            onChange={handleProductDetailsChange}
            rows={8}
            cols={64}
            required
          />
        </p>

        <p>
          <label htmlFor="category">Category</label>
          <br />
          <input
            id="category"
            type="text"
            value={category}
            onChange={handleCategoryChange}
            required
          />
        </p>

        <p>
          <label htmlFor="voice-gender">Voice gender</label>
          <br />
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
        </p>

        <fieldset>
          <legend>Reference images - fixed slots 1 to 5</legend>
          {REFERENCE_SLOTS.map((slot) => (
            <p key={slot}>
              <label htmlFor={`reference-${slot}`}>Reference slot {slot}</label>
              <br />
              <input
                id={`reference-${slot}`}
                data-slot={slot}
                type="file"
                accept="image/*"
                onChange={handleReferenceChange}
              />
            </p>
          ))}
        </fieldset>

        <p aria-live="polite">
          {pendingFileReads > 0
            ? `Reading ${pendingFileReads} image file(s)...`
            : `${selectedReferences.length} reference image(s) ready.`}
        </p>

        <button type="submit" disabled={!canSubmit}>
          {isSubmitting ? 'Analyzing evidence...' : 'Analyze evidence'}
        </button>{' '}
        <button type="button" onClick={handleRunPipeline} disabled={!canRunPipeline}>
          {isRunningPipeline ? 'Running full pipeline...' : 'Run full pipeline'}
        </button>
      </form>

      {error !== '' ? (
        <section aria-live="assertive">
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {evidence ? (
        <section>
          <h2>EvidencePackageV2</h2>
          <button type="button" onClick={handlePlanScenes} disabled={isPlanning}>
            {isPlanning ? 'Planning 4 scenes...' : 'Plan 4 scenes'}
          </button>
          <pre>{JSON.stringify(evidence, null, 2)}</pre>
        </section>
      ) : null}

      {scenePlan ? (
        <section>
          <h2>ScenePlanSetV2</h2>
          <button type="button" onClick={handleCompilePrompts} disabled={isCompiling}>
            {isCompiling ? 'Compiling final prompts...' : 'Compile final prompts'}
          </button>
          <pre>{JSON.stringify(scenePlan, null, 2)}</pre>
        </section>
      ) : null}

      {compiledPrompts ? (
        <section>
          <h2>CompiledPromptSetV2</h2>
          <pre>{JSON.stringify(compiledPrompts, null, 2)}</pre>
        </section>
      ) : null}
    </main>
  );
}
