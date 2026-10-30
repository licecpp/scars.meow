// Premium gates removed - everything is free.
//
// This helper is kept as a no-op so all existing call sites (profile PUT/PATCH,
// appearance, effects routes) continue to work without importing errors. No
// fields are stripped or rejected anymore: every user can set custom fonts,
// gradients, outlines, hover/cursor/username effects, display name overlay,
// and profile metadata (favicon, embed title/description/image/color).
//

export interface StripResult {
  updates: Record<string, unknown>
  strippedKeys: string[]
}

export function stripPremiumFields(
  updates: Record<string, unknown>,
  isPremium: boolean = true,
): StripResult {
  // Everything is free - pass all updates through unchanged.
  return { updates, strippedKeys: [] }
}

// Always false: no field requires premium anymore.
export function hasPremiumFields(updates: Record<string, unknown>): boolean {
  return false
}
