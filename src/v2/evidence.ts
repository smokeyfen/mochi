import type {
  EvidenceInputV2,
  ReferenceSlot,
} from './contracts';

export function validateEvidenceInputV2(input: EvidenceInputV2): readonly string[] {
  const errors: string[] = [];

  if (input.productName.trim() === '') {
    errors.push('productName is required');
  }

  if (input.productDetails.trim() === '') {
    errors.push('productDetails is required');
  }

  if (input.category.trim() === '') {
    errors.push('category is required');
  }

  if (input.references.length < 1 || input.references.length > 5) {
    errors.push('references must contain between 1 and 5 items');
  }

  const seenSlots = new Set<ReferenceSlot>();

  for (const reference of input.references) {
    if (seenSlots.has(reference.slot)) {
      errors.push(`reference slot ${reference.slot} is duplicated`);
    } else {
      seenSlots.add(reference.slot);
    }

    if (!reference.mimeType.trim().toLowerCase().startsWith('image/')) {
      errors.push(`reference slot ${reference.slot} mimeType must be an image type`);
    }

    if (reference.dataBase64.trim() === '') {
      errors.push(`reference slot ${reference.slot} dataBase64 is required`);
    }
  }

  return errors;
}

export function referenceIdForSlot(slot: ReferenceSlot): string {
  return `ref-${slot}`;
}

export async function createSourceFingerprint(input: EvidenceInputV2): Promise<string> {
  const canonicalInput = {
    productName: input.productName.trim(),
    productDetails: input.productDetails.trim(),
    category: input.category.trim(),
    voiceGender: input.voiceGender,
    references: [...input.references]
      .sort((left, right) => left.slot - right.slot)
      .map((reference) => ({
        slot: reference.slot,
        mimeType: reference.mimeType.trim().toLowerCase(),
        dataBase64: reference.dataBase64.replace(/\s/g, ''),
      })),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(canonicalInput));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);

  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
