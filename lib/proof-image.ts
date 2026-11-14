import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { sniffImageMime } from '@/lib/image-sniff';

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
  /** Eagerly cached bytes read at pick time on web so Android Chrome File/content URI expiry before Submit doesn't fail. */
  bytes?: ArrayBuffer;
}

/**
 * Returns true when an error indicates the underlying file or content URI could no longer be read
 * (e.g. Android Chrome expiring a File/content URI between pick time and submit time).
 */
export function isUnreadableFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : undefined;
  if (name === 'NotFoundError' || name === 'NotReadableError') return true;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : undefined;
  return message !== undefined && /could not be found/i.test(message);
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
    // Explicit (this is already the default): a forced crop would cut off the top or bottom of a tall, full-height
    // trainer-code or appraisal screenshot, taking the handle, friend code, or catch date with it.
    allowsEditing: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  const filename = asset.fileName ?? asset.uri.split('/').pop() ?? 'proof';
  if (asset.fileSize !== undefined && asset.fileSize > PROOF_MAX_BYTES) {
    throw new ProofImageError(`That image is ${formatBytes(asset.fileSize)}. The limit is 5 MB.`);
  }

  if (Platform.OS === 'web') {
    let rawBytes: ArrayBuffer;
    try {
      if (asset.file) {
        rawBytes = await asset.file.arrayBuffer();
      } else {
        const response = await fetch(asset.uri);
        if (!response.ok) throw new Error('fetch failed');
        rawBytes = await response.arrayBuffer();
      }
    } catch {
      throw new ProofImageError('Could not read that photo from your device. Please re-select the screenshot.');
    }

    if (rawBytes.byteLength > PROOF_MAX_BYTES) {
      throw new ProofImageError(`That image is ${formatBytes(rawBytes.byteLength)}. The limit is 5 MB.`);
    }
    const sniffed = sniffImageMime(rawBytes);
    if (!sniffed) {
      throw new ProofImageError('That file is not a JPEG, PNG or WebP image.');
    }

    return {
      uri: asset.uri,
      filename,
      contentType: sniffed,
      sizeBytes: rawBytes.byteLength,
      webFile: asset.file,
      bytes: rawBytes,
    };
  }

  const contentType = contentTypeFor(asset);
  return {
    uri: asset.uri,
    filename,
    contentType,
    sizeBytes: asset.fileSize ?? null,
    webFile: asset.file,
  };
}

/**
 * Reads the picked image as an ArrayBuffer for `supabase.storage.upload`. Blob, File and FormData
 * bodies do not work on React Native, and web has no expo-file-system `File`, hence the split.
 *
 * Also checks the bytes: the buckets' MIME allowlist only trusts the Content-Type header, so the returned
 * `contentType` is the one sniffed from the bytes (authoritative), not the picker's claim, and a file that is
 * not really a JPEG, PNG or WebP is refused here.
 */
export async function readProofBytes(proof: PickedProof): Promise<{ data: ArrayBuffer; contentType: ProofMimeType }> {
  let data: ArrayBuffer;
  if (proof.bytes !== undefined) {
    data = proof.bytes;
  } else {
    try {
      if (Platform.OS === 'web') {
        let blob: Blob;
        if (proof.webFile) {
          blob = proof.webFile;
        } else {
          const response = await fetch(proof.uri);
          if (!response.ok) {
            throw new ProofImageError(
              'Could not read that photo from your device. Please remove it and pick the screenshot again.'
            );
          }
          blob = await response.blob();
        }
        data = await blob.arrayBuffer();
      } else {
        data = await new File(proof.uri).arrayBuffer();
      }
    } catch (error) {
      if (error instanceof ProofImageError) throw error;
      if (isUnreadableFileError(error)) {
        throw new ProofImageError(
          'Could not read that photo from your device. Please remove it and pick the screenshot again.'
        );
      }
      throw error;
    }
  }
  if (data.byteLength > PROOF_MAX_BYTES) {
    throw new ProofImageError(`That image is ${formatBytes(data.byteLength)}. The limit is 5 MB.`);
  }
  const sniffed = sniffImageMime(data);
  if (!sniffed) throw new ProofImageError('That file is not a JPEG, PNG or WebP image.');
  return { data, contentType: sniffed };
}
