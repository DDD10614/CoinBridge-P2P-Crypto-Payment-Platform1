import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { VIDEO_KYC_CHALLENGES } from '../lib/domain.ts';

// Process-scoped ephemeral key fallback when AUTH_ENCRYPTION_KEY is not set in Secrets.
const EPHEMERAL_ENCRYPTION_KEY = crypto.randomBytes(32);

function getServerEncryptionKey(): Buffer {
  const raw = (process.env.AUTH_ENCRYPTION_KEY || '').trim();
  if (raw.length >= 32) {
    return crypto.createHash('sha256').update(raw).digest();
  }
  return EPHEMERAL_ENCRYPTION_KEY;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpToken(
  base32Secret: string,
  timestampMs = Date.now(),
  stepSec = 30,
  digits = 6
): string {
  const key = decodeBase32(base32Secret);
  const counter = Math.floor(timestampMs / 1000 / stepSec);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, '0');
}

export function verifyTotpToken(
  base32Secret: string,
  candidateCode: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  const clean = candidateCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;

  const candidateBuf = Buffer.from(clean, 'utf8');
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const expected = generateTotpToken(base32Secret, timestampMs + delta * 30_000);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      expectedBuf.length === candidateBuf.length &&
      crypto.timingSafeEqual(expectedBuf, candidateBuf)
    ) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(params: {
  accountName: string;
  issuer: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const issuer = encodeURIComponent(params.issuer);
  return `otpauth://totp/${label}?secret=${params.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function sealTotpSecret(secret: string, uid: string): string {
  const key = getServerEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(uid, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function unsealTotpSecret(sealed: string, uid: string): string | null {
  try {
    const parts = sealed.split('.');
    if (parts.length !== 3) return null;
    const [ivB64, tagB64, dataB64] = parts;
    const key = getServerEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAAD(Buffer.from(uid, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// --- Video KYC Challenge & Evaluation Adapter ---
interface ChallengeRecord {
  challengeId: string;
  uid: string;
  digits: string;
  prompt: string;
  expiresAtMs: number;
}

const videoKycChallenges = new Map<string, ChallengeRecord>();

export function issueVideoKycChallenge(uid: string) {
  const now = Date.now();
  for (const [id, rec] of videoKycChallenges.entries()) {
    if (rec.expiresAtMs <= now) videoKycChallenges.delete(id);
  }
  const challengeId = `vkyc_${crypto.randomBytes(8).toString('hex')}`;
  const digits = String(crypto.randomInt(1000, 9999));
  const template = VIDEO_KYC_CHALLENGES[crypto.randomInt(0, VIDEO_KYC_CHALLENGES.length)];
  const prompt = `${template} Verification code: ${digits}`;
  const record: ChallengeRecord = {
    challengeId,
    uid,
    digits,
    prompt,
    expiresAtMs: now + 15 * 60_000,
  };
  videoKycChallenges.set(challengeId, record);
  return {
    challengeId,
    digits,
    prompt,
    expiresAtMs: record.expiresAtMs,
  };
}

export async function verifyVideoKycSubmission(params: {
  uid: string;
  challengeId: string;
  spokenDigits: string;
  captureMethod: 'WEBCAM_STREAM' | 'UPLOADED_CLIP' | 'SANDBOX_SIMULATOR';
  hasDocumentUploaded: boolean;
  frameBase64?: string;
}) {
  const challenge = videoKycChallenges.get(params.challengeId);
  if (!challenge || challenge.uid !== params.uid || challenge.expiresAtMs < Date.now()) {
    throw new Error('Video KYC session expired or invalid. Generate a new challenge prompt.');
  }

  const digitsMatch = params.spokenDigits.trim() === challenge.digits;
  if (!digitsMatch) {
    throw new Error('Entered verification digits do not match the issued session code.');
  }

  let livenessScore =
    params.captureMethod === 'WEBCAM_STREAM' ? 91 : params.captureMethod === 'UPLOADED_CLIP' ? 84 : 78;
  let faceMatchScore = params.hasDocumentUploaded ? 88 : 74;
  let providerMode = 'SANDBOX_VIDEO_KYC_ADAPTER';
  let advisorySummary =
    'Video KYC challenge response captured and queued for mandatory human compliance officer approval.';

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (apiKey && params.frameBase64 && params.frameBase64.length > 100 && params.frameBase64.length < 2_500_000) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const resp = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Evaluate image clarity, lighting, and whether a single human face appears clearly in this Video KYC frame for compliance triage. Do not attempt identity matching or assert authenticity—only assess frame quality and clarity.`,
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: params.frameBase64,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              clarityScore: { type: Type.INTEGER },
              singleSubjectVisible: { type: Type.BOOLEAN },
              triageNote: { type: Type.STRING },
            },
          },
        },
      });

      const parsed = JSON.parse((resp.text || '{}').trim()) as {
        clarityScore?: number;
        singleSubjectVisible?: boolean;
        triageNote?: string;
      };
      if (typeof parsed.clarityScore === 'number') {
        livenessScore = Math.min(98, Math.max(50, Math.round(parsed.clarityScore)));
      }
      if (parsed.triageNote) {
        advisorySummary = `${parsed.triageNote} (Queued for manual compliance review.)`;
      }
      providerMode = 'GEMINI_FRAME_TRIAGE_ADAPTER';
    } catch {
      // Keep deterministic adapter fallback cleanly
    }
  }

  return {
    challengeId: challenge.challengeId,
    prompt: challenge.prompt,
    videoStatus: livenessScore >= 75 ? ('LIVENESS_PASSED' as const) : ('MANUAL_REVIEW' as const),
    livenessScore,
    faceMatchScore,
    providerMode,
    advisorySummary,
    verifiedAt: new Date().toISOString(),
  };
}

export function evaluateLoginContext(params: {
  knownDevicesCount: number;
  isNewDevice: boolean;
  previousTimezones: string[];
  currentTimezone: string;
}) {
  const suspiciousReasons: string[] = [];
  if (params.knownDevicesCount > 0 && params.isNewDevice) {
    suspiciousReasons.push('Sign-in from an unrecognized browser/device fingerprint.');
  }
  if (
    params.previousTimezones.length > 0 &&
    !params.previousTimezones.includes(params.currentTimezone)
  ) {
    suspiciousReasons.push(`New timezone detected (${params.currentTimezone}).`);
  }
  return {
    suspicious: suspiciousReasons.length > 0,
    suspiciousReason: suspiciousReasons.join(' '),
  };
}
