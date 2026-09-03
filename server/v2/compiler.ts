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

const MAX_PROMPT_CHARACTERS = 4_000;

const ACTION_DIRECTIONS: Record<SceneAction, string> = {
  PRESENT:
    'Hands present the product steadily and keep it dominant in frame. This is staging only, not proof of an invisible claim.',
  MOVE:
    'Hands move the whole product in a controlled readable way, then settle it. Treat the motion as staging unless this is a grounded demonstration.',
  REORIENT:
    'Hands turn or reposition the whole product clearly for inspection.',
  PRESS_RELEASE:
    'Perform a simple whole-product manual actuation, fully release, then let the product move afterward. Do not depict or name any hidden motor, spring, or internal mechanism.',
  OPEN:
    'Open the grounded product or packaging relationship in a clear physically plausible motion.',
  CLOSE:
    'Close the grounded product or packaging relationship in a clear physically plausible motion.',
  CONNECT:
    'Connect the grounded parts clearly; do not invent adapters, parts, or mechanisms.',
  DISCONNECT:
    'Disconnect the grounded parts clearly; do not invent extra parts or mechanisms.',
  REMOVE:
    'Remove the grounded part or item clearly.',
};

const CAMERA_DIRECTIONS: Record<CameraIntent, string> = {
  OVERVIEW_REVEAL:
    'Use a medium-wide or wide view that clearly shows the entire product or set. A slightly elevated or front-diagonal viewpoint is appropriate, with a slow reveal or gentle push. Do not turn this into a close product shot or sacrifice action readability for visual variety.',
  ACTION_READABILITY:
    'Use a product-level side view or near side profile aligned to the action. Keep the hands, release point, product, and full motion path unobstructed, with the camera mostly stable. Do not use a decorative orbit or dramatic angle.',
  DETAIL_INSPECTION:
    'Use close detail framing from the viewpoint that makes the specific detail easiest to inspect. A low oblique or other detail-specific angle is appropriate, with only a small micro movement. Do not default to a three-quarter view when another angle reads the detail better, and never make the action harder to read for the sake of difference.',
  PRODUCT_PRESENTATION:
    'Use a clean product-level frontal view or shallow hero angle, with a restrained slow push/pull or very light natural handheld movement. Do not repeat the elevated overview viewpoint or default to the same three-quarter angle as another scene. Preserve action readability whenever the product is being handled.',
};

const CUT_DIRECTIONS: Record<CutPreference, string> = {
  CONTINUOUS: 'One uninterrupted take; no cut.',
  ONE_CUT:
    'Use zero or one purposeful cut only if it improves readability; never split a causal demonstration across the cut.',
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

  return supportingFacts.length > 0
    ? `Grounded claim: ${primaryFact.text}\nSupporting context: ${supportingFacts.join(' | ')}`
    : `Grounded claim: ${primaryFact.text}`;
}

function identityDirection(evidence: EvidencePackageV2): string {
  return [
    `Product: ${evidence.product.productName}.`,
    `Visible form: ${evidence.product.shapeAndGeometry}`,
    `Surface appearance: ${evidence.product.materialAppearance}`,
    `Setting: ${evidence.product.environmentAnchor}.`,
    'Use only colors, markings, packaging details, and variant traits actually visible in the production references supplied for the scene; never merge incompatible visible variants.',
  ].join('\n');
}

function referenceDirection(): string {
  return [
    'Use the production references supplied for this scene to preserve product identity, proportions, and visible traits.',
    'Ignore source-image overlays, UI, and watermarks. Do not invent parts, labels, accessories, packaging features, or mechanisms.',
  ].join('\n');
}

function modeDirection(scene: ScenePlanV2): string {
  return scene.mode === 'DEMONSTRATION'
    ? 'Demonstrate only the grounded behavior with clear cause-and-effect; supporting movement must remain physically plausible, evidence-compatible, and secondary to that readable causal action.'
    : 'Treat handling as visual presentation only; natural supporting handling may aid observation, but it must not imply proof of invisible properties, specifications, safety, or hidden behavior.';
}

function compileScene(
  scene: ScenePlanV2,
  evidence: EvidencePackageV2,
): CompiledScenePromptV2 {
  const dialogue = JSON.stringify(scene.dialogue);
  const finalPrompt = [
    'Create one 8-second vertical 9:16 photorealistic KOC product-review scene. Product-first, sincere and everyday, believable physics, no polished TV-commercial feel.',
    '',
    'PRODUCT / REFERENCES',
    identityDirection(evidence),
    referenceDirection(),
    '',
    'SCENE',
    `${scene.sceneNumber}. ${scene.mode}. ${scene.focus}.`,
    factContext(scene, evidence),
    modeDirection(scene),
    '',
    'ACTION',
    `${scene.action} is the primary action: ${ACTION_DIRECTIONS[scene.action]}`,
    'Simple natural supporting movements are optional when they directly support the primary action and fit the grounded product. Never create a complex or unsupported action sequence.',
    '',
    'CAMERA / EDIT',
    `${scene.cameraIntent}: ${CAMERA_DIRECTIONS[scene.cameraIntent]}`,
    CUT_DIRECTIONS[scene.cutPreference],
    '',
    'HANDS / AUDIO',
    'Only adult reviewer hands may enter frame; no face or full body. Keep hand motion natural and secondary to the product.',
    `One off-camera ${voiceLabel(evidence.voiceGender)} Vietnamese speaker. Say exactly once: ${dialogue}`,
    'Deliver it like a real KOC speaking while looking at or handling the product now: relaxed conversational Vietnamese, natural micro-pauses, no announcer voice.',
    'No second speaker, extra spoken claims, captions, subtitles, or invented promotional text. Natural room tone is fine.',
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
    inspectionMetadata: {
      productName: evidence.product.productName,
      sceneMode: scene.mode,
      action: scene.action,
      dialogue: scene.dialogue,
      cameraIntent: scene.cameraIntent,
    },
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
