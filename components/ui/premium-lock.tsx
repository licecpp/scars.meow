'use client'

import Link from 'next/link'
import { IconCrown, IconLock } from '@tabler/icons-react'

interface PremiumLockProps {
  isPremium: boolean
  children: React.ReactNode
  featureName?: string
  variant?: 'overlay' | 'inline' | 'badge'
}

// Everything is free - PremiumLock always renders children unlocked.
// Kept as a component so existing call sites don't break.
export function PremiumLock({ isPremium = true, children, featureName, variant = 'overlay' }: PremiumLockProps) {
  return <>{children}</>
}

// Simple badge to show on premium options - now always shows nothing
// since everything is free.
export function PremiumBadge() {
  return null
}
