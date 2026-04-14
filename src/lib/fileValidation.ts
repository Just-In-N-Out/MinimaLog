/**
 * File Validation Utility
 *
 * Security: Validates file content using magic bytes (file signatures)
 * instead of trusting MIME types which can be easily spoofed
 */

// Magic bytes (file signatures) for allowed image types
const IMAGE_SIGNATURES = {
  jpeg: [
    [0xff, 0xd8, 0xff, 0xe0], // JFIF format
    [0xff, 0xd8, 0xff, 0xe1], // EXIF format
    [0xff, 0xd8, 0xff, 0xe2], // Another JPEG variant
    [0xff, 0xd8, 0xff, 0xe3], // Another JPEG variant
    [0xff, 0xd8, 0xff, 0xdb], // JPEG raw
  ],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  webp: [
    [0x52, 0x49, 0x46, 0x46], // "RIFF" at start
    // Note: WEBP also has "WEBP" at offset 8, but checking first 4 bytes is sufficient
  ],
} as const;

// SVG is explicitly blocked for security (XSS risk)
const BLOCKED_SIGNATURES = {
  svg: [
    [0x3c, 0x3f, 0x78, 0x6d, 0x6c], // "<?xml"
    [0x3c, 0x73, 0x76, 0x67], // "<svg"
  ],
};

interface ValidationResult {
  isValid: boolean;
  detectedType?: string;
  error?: string;
}

/**
 * Read the first bytes of a file to check its magic signature
 */
async function readFileSignature(file: File, bytesToRead: number = 8): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      if (event.target?.result) {
        const bytes = new Uint8Array(event.target.result as ArrayBuffer);
        resolve(bytes.slice(0, bytesToRead));
      } else {
        reject(new Error('Failed to read file'));
      }
    };

    reader.onerror = () => reject(new Error('Error reading file'));

    // Read only the first bytes we need
    const blob = file.slice(0, bytesToRead);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Check if bytes match a signature pattern
 */
function matchesSignature(fileBytes: Uint8Array, signature: number[]): boolean {
  if (fileBytes.length < signature.length) {
    return false;
  }

  return signature.every((byte, index) => fileBytes[index] === byte);
}

/**
 * Detect file type by magic bytes
 */
function detectFileType(fileBytes: Uint8Array): string | null {
  // Check for blocked types first
  for (const [type, signatures] of Object.entries(BLOCKED_SIGNATURES)) {
    for (const signature of signatures) {
      if (matchesSignature(fileBytes, signature)) {
        return `blocked:${type}`;
      }
    }
  }

  // Check for allowed image types
  for (const [type, signatures] of Object.entries(IMAGE_SIGNATURES)) {
    for (const signature of signatures) {
      if (matchesSignature(fileBytes, signature)) {
        return type;
      }
    }
  }

  return null;
}

/**
 * Validate image file using magic byte checking
 *
 * @param file - The file to validate
 * @param allowedTypes - Array of allowed MIME types (for basic pre-check)
 * @param maxSizeBytes - Maximum file size in bytes
 * @returns ValidationResult with isValid flag and details
 */
export async function validateImageFile(
  file: File,
  allowedTypes: string[] = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  maxSizeBytes: number = 5 * 1024 * 1024 // 5MB default
): Promise<ValidationResult> {
  try {
    // 1. Basic MIME type check (quick pre-validation)
    if (!allowedTypes.includes(file.type)) {
      return {
        isValid: false,
        error: `Invalid file type. Only ${allowedTypes.join(', ')} are allowed.`,
      };
    }

    // 2. File size check
    if (file.size > maxSizeBytes) {
      const maxSizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
      return {
        isValid: false,
        error: `File too large. Maximum size is ${maxSizeMB}MB.`,
      };
    }

    // 3. Empty file check
    if (file.size === 0) {
      return {
        isValid: false,
        error: 'File is empty.',
      };
    }

    // 4. Magic byte validation (actual content check)
    const fileBytes = await readFileSignature(file, 8);
    const detectedType = detectFileType(fileBytes);

    if (!detectedType) {
      return {
        isValid: false,
        error: 'File type could not be verified. The file may be corrupted.',
      };
    }

    if (detectedType.startsWith('blocked:')) {
      const blockedType = detectedType.replace('blocked:', '');
      return {
        isValid: false,
        error: `${blockedType.toUpperCase()} files are not allowed for security reasons.`,
      };
    }

    // 5. Cross-check detected type with claimed MIME type
    const mimeTypeMap: Record<string, string[]> = {
      jpeg: ['image/jpeg', 'image/jpg'],
      png: ['image/png'],
      webp: ['image/webp'],
    };

    const expectedMimes = mimeTypeMap[detectedType] || [];
    if (!expectedMimes.includes(file.type)) {
      return {
        isValid: false,
        error: `File content doesn't match declared type. File appears to be ${detectedType} but was uploaded as ${file.type}.`,
      };
    }

    // All checks passed!
    return {
      isValid: true,
      detectedType,
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate file name for security
 * Prevents path traversal and other injection attacks
 */
export function validateFileName(fileName: string): { isValid: boolean; error?: string } {
  // Check for path traversal attempts
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return {
      isValid: false,
      error: 'File name contains invalid characters.',
    };
  }

  // Check for null bytes
  if (fileName.includes('\0')) {
    return {
      isValid: false,
      error: 'File name contains null bytes.',
    };
  }

  // Check length
  if (fileName.length > 255) {
    return {
      isValid: false,
      error: 'File name is too long.',
    };
  }

  // Check for empty name
  if (!fileName.trim()) {
    return {
      isValid: false,
      error: 'File name is empty.',
    };
  }

  return { isValid: true };
}

/**
 * Combined validation for file upload
 * Validates both file content and name
 */
export async function validateFileUpload(
  file: File,
  options: {
    allowedTypes?: string[];
    maxSizeBytes?: number;
  } = {}
): Promise<ValidationResult> {
  // Validate file name first
  const nameValidation = validateFileName(file.name);
  if (!nameValidation.isValid) {
    return {
      isValid: false,
      error: nameValidation.error,
    };
  }

  // Then validate file content
  return validateImageFile(file, options.allowedTypes, options.maxSizeBytes);
}
