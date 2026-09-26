import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** Mirrors both proof buckets' limits (supabase/config.toml): `listing-proofs` (migration …000600) and
 *  `profile-proofs` (migration …000100) are each capped at 5 MiB, jpeg/png/webp. */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

export type ProofMimeType = (typeof MIME_BY_EXTENSION)[keyof typeof MIME_BY_EXTENSION];

const ALLOWED_MIME_TYPES: readonly string[] = Object.values(MIME_BY_EXTENSION);

/** A user-facing problem with a picked image (wrong type, too large, unreadable). */
export class ProofImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofImageError';
  }
}

export interface PickedProof {
  /** Local uri, safe to show in an <Image>. */
  uri: string;
  filename: string;
  contentType: ProofMimeType;
  /** Size reported by the picker; null when the platform does not report one. */
  sizeBytes: number | null;
  /** Browser file behind the uri. Only set on web, where expo-file-system's `File` does not exist. */
  webFile?: Blob;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function contentTypeFor(asset: ImagePicker.ImagePickerAsset): ProofMimeType {
  let candidate = asset.mimeType?.toLowerCase();
  if (!candidate || candidate === 'image/jpg') {
    const extension = (asset.fileName ?? asset.uri).split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    candidate = MIME_BY_EXTENSION[extension as keyof typeof MIME_BY_EXTENSION] ?? candidate;
  }
  if (!candidate || !ALLOWED_MIME_TYPES.includes(candidate)) {
    throw new ProofImageError('Use a JPEG, PNG or WebP screenshot.');
  }
  return candidate as ProofMimeType;
}

/**
 * Opens the photo library for one screenshot. Returns null when the trainer cancels. iOS needs no
 * photo permission for the system picker. `quality` < 1 makes iOS/Android re-encode to JPEG, which
 * keeps HEIC out of a bucket that rejects it and keeps most screenshots under the 5 MiB limit.
 */
export async function pickProofImage(): Promise<PickedProof | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.85,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  const contentType = contentTypeFor(asset);
  if (asset.fileSize !== undefined && asset.fileSize > PROOF_MAX_BYTES) {
    throw new ProofImageError(`That image is ${formatBytes(asset.fileSize)}. The limit is 5 MB.`);
  }

  return {
    uri: asset.uri,
    filename: asset.fileName ?? asset.uri.split('/').pop() ?? 'proof',
    contentType,
    sizeBytes: asset.fileSize ?? null,
    webFile: asset.file,
  };
}

/**
 * Reads the picked image as an ArrayBuffer for `supabase.storage.upload`. Blob, File and FormData
 * bodies do not work on React Native, and web has no expo-file-system `File`, hence the split.
 */
export async function readProofBytes(proof: PickedProof): Promise<ArrayBuffer> {
  let data: ArrayBuffer;
  if (Platform.OS === 'web') {
    const blob = proof.webFile ?? (await (await fetch(proof.uri)).blob());
    data = await blob.arrayBuffer();
  } else {
    data = await new File(proof.uri).arrayBuffer();
  }
  if (data.byteLength > PROOF_MAX_BYTES) {
    throw new ProofImageError(`That image is ${formatBytes(data.byteLength)}. The limit is 5 MB.`);
  }
  return data;
}
