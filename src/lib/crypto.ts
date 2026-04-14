/**
 * Web Crypto API Wrapper
 *
 * Provides encryption/decryption utilities using AES-GCM
 * Security: Uses modern browser crypto APIs for secure encryption
 */

// Encryption configuration
const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256; // 256-bit AES
const IV_LENGTH = 12; // 12 bytes for GCM
const SALT_LENGTH = 16; // 16 bytes for key derivation
const ITERATIONS = 100000; // PBKDF2 iterations

/**
 * Check if WebCrypto API is available
 * iOS WebView may not support crypto.subtle
 */
export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' &&
         typeof crypto.subtle !== 'undefined' &&
         typeof crypto.getRandomValues === 'function';
}

/**
 * Generate a cryptographically secure random encryption key
 * This key should be stored securely (never in plain text)
 */
export async function generateEncryptionKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive an encryption key from a password using PBKDF2
 * Used for password-based encryption
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-GCM key from password
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    false, // not extractable for security
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random salt for key derivation
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Generate a random initialization vector (IV)
 */
function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Export a CryptoKey to a base64 string for storage
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(exported);
}

/**
 * Import a CryptoKey from a base64 string
 */
export async function importKey(keyString: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(keyString);
  return await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    {
      name: ALGORITHM,
      length: KEY_LENGTH,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM
 * Returns: base64-encoded string in format: iv.ciphertext
 */
export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    // Generate random IV for this encryption
    const iv = generateIV();

    // Encrypt the data
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv: iv,
      },
      key,
      dataBuffer
    );

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);

    // Return as base64
    return arrayBufferToBase64(combined.buffer);
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data using AES-GCM
 * Expects: base64-encoded string in format: iv.ciphertext
 */
export async function decrypt(encryptedData: string, key: CryptoKey): Promise<string> {
  try {
    // Decode from base64
    const combined = base64ToArrayBuffer(encryptedData);
    const combinedArray = new Uint8Array(combined);

    // Extract IV and ciphertext
    const iv = combinedArray.slice(0, IV_LENGTH);
    const ciphertext = combinedArray.slice(IV_LENGTH);

    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: iv,
      },
      key,
      ciphertext
    );

    // Decode to string
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Encrypt a JavaScript object (converts to JSON first)
 */
export async function encryptObject<T>(obj: T, key: CryptoKey): Promise<string> {
  const jsonString = JSON.stringify(obj);
  return await encrypt(jsonString, key);
}

/**
 * Decrypt to a JavaScript object (parses JSON)
 */
export async function decryptObject<T>(encryptedData: string, key: CryptoKey): Promise<T> {
  const jsonString = await decrypt(encryptedData, key);
  return JSON.parse(jsonString) as T;
}

/**
 * Hash a string using SHA-256 (useful for creating keys from user IDs)
 */
export async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

// ============================================================================
// Utility functions for base64 encoding/decoding
// ============================================================================

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ============================================================================
// Session-specific encryption helpers
// ============================================================================

/**
 * Generate or retrieve an encryption key for the current session
 * This key is stored in sessionStorage (memory-only, cleared on tab close)
 */
const SESSION_KEY_STORAGE = '_app_crypto_key';

export async function getOrCreateSessionKey(): Promise<CryptoKey | null> {
  // Check if WebCrypto is available (iOS WebView may not support it)
  if (!isWebCryptoAvailable()) {
    console.warn('[Crypto] WebCrypto API not available, encryption disabled');
    return null;
  }

  // Try to get existing key from sessionStorage
  const existingKey = sessionStorage.getItem(SESSION_KEY_STORAGE);

  if (existingKey) {
    try {
      return await importKey(existingKey);
    } catch (error) {
      console.warn('Failed to import existing key, generating new one');
    }
  }

  // Generate new key
  const key = await generateEncryptionKey();
  const exportedKey = await exportKey(key);
  sessionStorage.setItem(SESSION_KEY_STORAGE, exportedKey);

  return key;
}

/**
 * Clear the session encryption key (e.g., on logout)
 */
export function clearSessionKey(): void {
  sessionStorage.removeItem(SESSION_KEY_STORAGE);
}

/**
 * Generate a deterministic key from user ID
 * This allows encrypting data per-user without storing keys
 * WARNING: This is less secure than random keys, use only when necessary
 */
export async function deriveKeyFromUserId(userId: string): Promise<CryptoKey | null> {
  // Check if WebCrypto is available (iOS WebView may not support it)
  if (!isWebCryptoAvailable()) {
    console.warn('[Crypto] WebCrypto API not available, cannot derive key from user ID');
    return null;
  }

  // Use user ID as "password" with a fixed salt derived from app name
  // Note: This is deterministic, so same userId always produces same key
  const appSalt = new TextEncoder().encode('minimalog-app-v1');
  const salt = await crypto.subtle.digest('SHA-256', appSalt);

  return await deriveKeyFromPassword(userId, new Uint8Array(salt));
}
