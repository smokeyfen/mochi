import type {
  CameraIntent,
  CompiledPromptSetV2,
  CompiledScenePromptV2,
  CutPreference,
  EvidencePackageV2,
  ProductFact,
  SceneAction,
  ScenePlanSetV2,
  ScenePlanV2,
  VoiceGender,
} from '../../src/v2/contracts';

const MAX_PROMPT_CHARACTERS = 5_000;

const ACTION_DIRECTIONS: Record<SceneAction, string> = {
  PRESENT:
    'Reviewer hands bring the product clearly into frame and present it steadily. Keep the gesture simple and product-first; presentation itself must not imply proof of an invisible property.',
  MOVE:
    'Reviewer hands move the whole product once in a controlled, readable way, then settle it. Treat this as staging unless the grounded scene is explicitly a demonstration.',
  REORIENT:
    'Reviewer hands reorient the whole product once for inspection, using one clean turn or repositioning motion and no second major action.',
  PRESS_RELEASE:
    'Reviewer hands perform one simple whole-product actuation consistent with the grounded behavior, then fully release. The product moves only after release. Do not depict, name, or expose any hidden motor, spring, internal mechanism, or extra actuation.',
  OPEN:
    'Reviewer hands open the grounded product or packaging relationship once in a clear, physically plausible motion; do not add a second major action.',
  CLOSE:
    'Reviewer hands close the grounded product or packaging relationship once in a clear, physically plausible motion; do not add a second major action.',
  CONNECT:
    'Reviewer hands connect the grounded parts once in a clear, physically plausible motion; do not invent extra parts, adapters, or mechanisms.',
  DISCONNECT:
    'Reviewer hands disconnect the grounded parts once in a clear, physically plausible motion; do not invent extra parts or mechanisms.',
  REMOVE:
    'Reviewer hands remove the grounded part or item once in a clear, physically plausible motion; do not introduce any additional major action.',
};

const CAMERA_DIRECTIONS: Record<CameraIntent, string> = {
  OVERVIEW_REVEAL:
    'Use a slightly elevated medium-wide three-quarter composition that establishes the complete product or set clearly. Keep perspective natural, with a restrained slow push-in or subtle handheld recentering rather than an orbit.',
  ACTION_READABILITY:
    'Use a side or three-quarter medium-close composition aligned with the physical action. Keep the hands, product, release point, and immediate motion path unobstructed. Favor a mostly stable camera with only subtle natural recentering.',
  DETAIL_INSPECTION:
    'Use a close three-quarter detail composition that makes the selected visible features easy to inspect. Use only a short, slow lateral drift or gentle micro push; avoid aggressive macro distortion.',
  PRODUCT_PRESENTATION:
    'Use a clean product-level or slight three-quarter hero composition. Keep the product dominant in frame with a restrained slow push or pull and small natural handheld imperfections.',
};

const CUT_DIRECTIONS: Record<CutPreference, string> = {
  CONTINUOUS:
    'Use one uninterrupted take with no cut. Preserve causal continuity from hand action through the visible result.',
  ONE_CUT:
    'Use exactly one purposeful cut only if it improves presentation or detail readability. Never split the causal portion of a physical demonstration across the cut.',
};

function voiceLabel(voiceGender: VoiceGender): string {
  return voiceGender === 'FEMALE' ? 'female' : 'male';
}

function referenceIdsForFact(fact: ProductFact): Set<string> {
  return new Set([
    ...fact.supportingReferenceIds,
    ...fact.compatibleReferenceIds,
  ]);
}

function validateInputs(
  evidence: EvidencePackageV2,
  scenePlan: ScenePlanSetV2,
): string[] {
  const errors: string[] = [];

  if (evidence.contractVersion !== 1 || scenePlan.contractVersion !== 1) {
    errors.push('unsupported contract version');
  }
  if (
    evidence.sourceFingerprint.trim() === '' ||
    scenePlan.sourceFingerprint.trim() === '' ||
    evidence.sourceFingerprint !== scenePlan.sourceFingerprint
  ) {
    errors.push('source fingerprint mismatch');
  }
  if (evidence.voiceGender !== scenePlan.voiceGender) {
    errors.push('voice gender mismatch');
  }
  if (scenePlan.scenes.length !== 4) {
    errors.push('scene plan must contain exactly four scenes');
  }

  const factsById = new Map(evidence.facts.map((fact) => [fact.factId, fact]));
  const referencesById = new Map(
    evidence.references.map((reference) => [reference.referenceId, reference]),
  );

  scenePlan.scenes.forEach((scene, index) => {
    const prefix = `scenes[${index}]`;
    const expectedSceneNumber = index + 1;
    const primaryFact = factsById.get(scene.primaryFactId);

    if (scene.sceneNumber !== expectedSceneNumber) {
      errors.push(`${prefix}.sceneNumber is out of sequence`);
    }
    if (!primaryFact) {
      errors.push(`${prefix}.primaryFactId is unknown`);
      return;
    }
    if (
      scene.supportingFactIds.some(
        (factId) => factId === scene.primaryFactId || !factsById.has(factId),
      )
    ) {
      errors.push(`${prefix}.supportingFactIds is invalid`);
    }
    if (!referencesById.has(scene.primaryReferenceId)) {
      errors.push(`${prefix}.primaryReferenceId is unknown`);
    }
    if (!referenceIdsForFact(primaryFact).has(scene.primaryReferenceId)) {
      errors.push(`${prefix}.primaryReferenceId is not routed by the primary fact`);
    }
    if (
      scene.supportingReferenceIds.some(
        (referenceId) =>
          referenceId === scene.primaryReferenceId || !referencesById.has(referenceId),
      )
    ) {
      errors.push(`${prefix}.supportingReferenceIds is invalid`);
    }
    if (scene.mode === 'DEMONSTRATION' && primaryFact.mode !== 'DEMONSTRATABLE') {
      errors.push(`${prefix} cannot demonstrate a PRESENTATIONAL fact`);
    }
    if (scene.action === 'PRESS_RELEASE' && primaryFact.mode !== 'DEMONSTRATABLE') {
      errors.push(`${prefix}.PRESS_RELEASE requires a DEMONSTRATABLE primary fact`);
    }

    const variantKeys = new Set(
      [scene.primaryReferenceId, ...scene.supportingReferenceIds]
        .map((referenceId) => referencesById.get(referenceId)?.variantKey ?? null)
        .filter((variantKey): variantKey is string => variantKey !== null),
    );

    if (variantKeys.size > 1) {
      errors.push(`${prefix} mixes incompatible reference variants`);
    }
  });

  return errors;
}

function factContext(scene: ScenePlanV2, evidence: EvidencePackageV2): string {
  const factsById = new Map(evidence.facts.map((fact) => [fact.factId, fact]));
  const primaryFact = factsById.get(scene.primaryFactId);
  if (!primaryFact) {
    throw new Error(`Unknown primary fact: ${scene.primaryFactId}`);
  }

  const supportingFacts = scene.supportingFactIds.flatMap((factId) => {
    const fact = factsById.get(factId);
    return fact ? [fact.text] : [];
  });

  return [
    `Primary grounded fact: ${primaryFact.text}`,
    supportingFacts.length > 0
      ? `Supporting grounded context: ${supportingFacts.join(' | ')}`
      : 'Supporting grounded context: none.',
  ].join('\n');
}

function identityDirection(evidence: EvidencePackageV2): string {
  const colors = evidence.product.colors.join(', ');
  const markers = evidence.product.visibleMarkers.join(' | ');

  return [
    `Product: ${evidence.product.productName}.`,
    `Visible identity: ${evidence.product.shapeAndGeometry}`,
    colors ? `Visible colors: ${colors}.` : '',
    `Material appearance only: ${evidence.product.materialAppearance}`,
    markers ? `Visible markers: ${markers}.` : '',
    `Environment anchor: ${evidence.product.environmentAnchor}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function referenceDirection(scene: ScenePlanV2): string {
  const supports = scene.supportingReferenceIds.length
    ? scene.supportingReferenceIds.join(', ')
    : 'none';

  return [
    `Primary reference: ${scene.primaryReferenceId}.`,
    `Supporting references: ${supports}.`,
    'Preserve the exact visible product identity, proportions, colorway, markings, and compatible variant from the routed references. Do not import watermarks, social handles, prices, subtitles, app UI, or unrelated overlay text from the source images. Do not invent extra parts, labels, accessories, packaging features, or mechanisms.',
  ].join('\n');
}

function modeDirection(scene: ScenePlanV2): string {
  if (scene.mode === 'DEMONSTRATION') {
    return 'This is a truthful physical demonstration. Show only the grounded behavior selected by E2 and make the cause-and-effect easy to read. Do not add a second major action or stronger performance than the grounded fact states.';
  }

  return 'This is a presentation scene. The physical handling is staging for visual review, not proof of an invisible property, specification, material composition, safety claim, or hidden behavior.';
}

function compileScene(
  scene: ScenePlanV2,
  evidence: EvidencePackageV2,
): CompiledScenePromptV2 {
  const dialogue = JSON.stringify(scene.dialogue);
  const finalPrompt = [
    'Create an 8-second vertical 9:16 photorealistic product-review video. Product-first composition, simple believable physics, one coherent physical world, and no unnecessary cinematic complexity.',
    '',
    'PRODUCT IDENTITY',
    identityDirection(evidence),
    '',
    'REFERENCE ROUTING',
    referenceDirection(scene),
    '',
    'SCENE INTENT',
    `Scene ${scene.sceneNumber}. Mode: ${scene.mode}. Focus: ${scene.focus}.`,
    factContext(scene, evidence),
    modeDirection(scene),
    '',
    'PHYSICAL ACTION',
    `Major action: ${scene.action}.`,
    ACTION_DIRECTIONS[scene.action],
    '',
    'CAMERA',
    `Camera intent: ${scene.cameraIntent}.`,
    CAMERA_DIRECTIONS[scene.cameraIntent],
    '',
    'EDIT',
    CUT_DIRECTIONS[scene.cutPreference],
    '',
    'HANDS / AUDIO',
    'Only the adult reviewer hands may enter the frame; no face or full body. Keep hand motion natural, economical, and secondary to the product.',
    `Use one off-camera ${voiceLabel(evidence.voiceGender)} Vietnamese speaker. Say exactly once: ${dialogue}`,
    'Do not add a second speaker, extra spoken claims, on-screen captions, subtitles, or invented promotional text. Natural room tone is allowed; keep the spoken line clear.',
  ].join('\n');

  if (finalPrompt.length > MAX_PROMPT_CHARACTERS) {
    throw new Error(
      `Scene ${scene.sceneNumber} final prompt exceeds ${MAX_PROMPT_CHARACTERS} characters`,
    );
  }

  return {
    sceneNumber: scene.sceneNumber,
    finalPrompt,
    characterCount: finalPrompt.length,
    primaryReferenceId: scene.primaryReferenceId,
    supportingReferenceIds: [...scene.supportingReferenceIds],
  };
}

export function compilePromptsV2(
  evidence: EvidencePackageV2,
  scenePlan: ScenePlanSetV2,
): CompiledPromptSetV2 {
  const inputErrors = validateInputs(evidence, scenePlan);
  if (inputErrors.length > 0) {
    throw new Error(`Invalid compiler input: ${inputErrors.join(' | ')}`);
  }

  const scenes = scenePlan.scenes.map((scene) =>
    compileScene(scene, evidence),
  ) as unknown as CompiledPromptSetV2['scenes'];

  return {
    compilerVersion: 1,
    sourceFingerprint: evidence.sourceFingerprint,
    voiceGender: evidence.voiceGender,
    scenes,
  };
}
