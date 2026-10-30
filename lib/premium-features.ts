// Premium gates removed - everything is free.
//
// All feature/effect lists are now empty so no effect, font, hover, or cursor
// is treated as premium. The detector returns no premium features for any
// profile config, and isPremium* helpers always return false.

export const PREMIUM_FEATURES = {} as const

export type PremiumFeature = never

// No username, cursor, or hover effects require premium anymore.
export const PREMIUM_USERNAME_EFFECTS: string[] = []
export const PREMIUM_CURSOR_EFFECTS: string[] = []
export const PREMIUM_HOVER_EFFECTS: string[] = []

export function isPremiumFeature(feature: string): boolean {
  return false
}

export function isPremiumUsernameEffect(effect: string): boolean {
  return false
}

export function isPremiumCursorEffect(effect: string): boolean {
  return false
}

export function isPremiumHoverEffect(effect: string): boolean {
  return false
}

// Detector returns nothing - no config is premium-gated.
export function detectPremiumFeatures(config: Record<string, any>): string[] {
  return []
}
