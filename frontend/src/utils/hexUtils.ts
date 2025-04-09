// src/utils/hexUtils.ts
/**
 * Converts a Base64 string to a Hex string.
 * @param base64 The Base64 encoded string.
 * @returns The Hex encoded string.
 */
export function base64ToHex(base64: string): string {
  try {
    // Use Buffer for Node.js/browser compatibility and correct encoding handling
    // Ensure Buffer is available (it should be in Next.js environments)
    if (typeof Buffer === 'undefined') {
      console.warn('Buffer API not available. Falling back to atob for Base64->Hex conversion.');
      const raw = atob(base64);
      let result = '';
      for (let i = 0; i < raw.length; i++) {
        const hex = raw.charCodeAt(i).toString(16);
        result += (hex.length === 2 ? hex : '0' + hex);
      }
      return result;
    }
    return Buffer.from(base64, 'base64').toString('hex');
  } catch (e) {
    console.error("Failed to convert Base64 to Hex:", e);
    throw new Error("Invalid Base64 string provided for Hex conversion.");
  }
}