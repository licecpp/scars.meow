"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { Calendar, Eye, ExternalLink, MapPin, Pause, Play, SkipBack, SkipForward, Sparkles, Volume2, VolumeX } from 'lucide-react'
import { BackgroundEffectsOverlay, CustomFontFace, UsernameDisplay } from '@/components/profile/effect-overlays'
// Lazy-load the cursor effects layer (canvas + RAF + ~550 lines) so it only
// downloads & mounts when the visited profile actually uses a cursor effect.
const CursorEffectsLayer = dynamic(
  () => import('@/components/profile/cursor-effects').then((m) => m.CursorEffectsLayer),
  { ssr: false },
)
import { WidgetsPanel } from '@/components/profile/widgets-panel'
import { SocialIcon } from '@/components/profile/social-icon'
import {
  getButtonStyle,
  getCardContainerStyles,
  getPanelMaxWidth,
  getResolvedFontFamily,
  getSocialIconWrapperStyle,
  hexToRgba,
  isVideoUrl,
} from '@/lib/profile-style'
import { SOCIAL_PLATFORMS, type Badge, type CustomButton, type LoadoutPosition, type MusicTrack, type Profile, type ProfileBadgeLoadoutItem, type ProfileTitleLoadoutItem, type SocialLink } from '@/lib/types'
import { getCryptoBadgesForUser, userHasCryptoBadges } from '@/lib/crypto-badges'
import { decorationUrl as avatarDecorationUrl } from '@/lib/avatar-decoration-url'

/**
 * Background video that handles iOS / mobile autoplay quirks. Browsers
 * sometimes ignore the `autoPlay` attribute (iOS low-power mode, focus
 * restrictions, etc.), so we also call `.play()` on mount, when the video
 * is ready, and when the page first becomes visible. Failures are silenced.
 */
function BackgroundVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    const tryPlay = () => {
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    tryPlay()
    const onTouch = () => tryPlay()
    const onVis = () => { if (!document.hidden) tryPlay() }
    document.addEventListener('touchstart', onTouch, { passive: true, once: true })
    document.addEventListener('click', onTouch, { once: true })
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('touchstart', onTouch)
      document.removeEventListener('click', onTouch)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [src])
  return (
    <video
      ref={ref}
      src={src}
      autoPlay
      loop
      muted
      playsInline
      // @ts-expect-error - older iOS reads webkit-playsinline (kebab) too
      webkit-playsinline="true"
      preload="metadata"
      disablePictureInPicture
      controls={false}
      className={className}
      onCanPlay={(e) => {
        const v = e.currentTarget
        const p = v.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      }}
    />
  )
}

/**
 * Avatar with optional decoration overlay. Mirrors Discord's render: when a
 * decoration is present the avatar is shrunk to ~82% (centered with 9% inset)
 * within a fixed bounding box and the decoration fills the full 100% box on
 * top. With no decoration, the avatar fills the box normally.
 */
function AvatarWithDecoration({
  size,
  decorationSlug,
  avatarShapeStyle,
  children,
}: {
  size: number
  decorationSlug: string | null | undefined
  avatarShapeStyle: React.CSSProperties
  children: React.ReactNode
}) {
  if (!decorationSlug) {
    return (
      <div
        className="relative overflow-hidden rounded-full"
        style={{ width: size, height: size, ...avatarShapeStyle }}
      >
        {children}
      </div>
    )
  }
  // Discord avatar-decoration assets are designed with the avatar at ~82%
  // of the full asset, so scaling the decoration to 1/0.82 (~1.22x) makes
  // its transparent inner circle line up exactly with the avatar's outer
  // edge - regardless of the avatar shape (circle / soft / squircle /
  // rounded / square). Avatar itself stays at 100% of its native size.
  const outerSize = Math.round(size / 0.82)
  const offset = Math.round((outerSize - size) / 2)
  return (
    <div
      className="relative"
      style={{ width: outerSize, height: outerSize, marginLeft: -offset, marginTop: -offset }}
    >
      <div
        className="absolute overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          left: offset,
          top: offset,
          ...avatarShapeStyle,
        }}
      >
        {children}
      </div>
      <img
        src={avatarDecorationUrl(decorationSlug, 240)}
        alt=""
        aria-hidden
        decoding="async"
        loading="lazy"
        className="pointer-events-none absolute inset-0"
        style={{ width: outerSize, height: outerSize }}
      />
    </div>
  )
}

interface GunsProfileProps {
  profile: Profile
  socialLinks: SocialLink[]
  badges: Badge[]
  badgeLoadout?: ProfileBadgeLoadoutItem[]
  titleLoadout?: ProfileTitleLoadoutItem[]
  customButtons?: CustomButton[]
  musicTracks?: MusicTrack[]
  previewMode?: boolean
}

const brandColors: Record<string, string> = Object.fromEntries(
  (SOCIAL_PLATFORMS as ReadonlyArray<{ id: string; color: string }>).map(p => [p.id, p.color])
)

function getAvatarShapeStyle(shape?: string | null): CSSProperties {
  switch (shape) {
    case 'soft':     return { borderRadius: '35%' }
    case 'squircle': return { borderRadius: '22%' }
    case 'rounded':  return { borderRadius: '8px' }
    case 'square':   return { borderRadius: '2px' }
    default:         return {} // circle - keep rounded-full from className
  }
}

// Custom SVG badge icons - each badge has its own polished icon
function BadgeIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const k = (name || '').toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-')

  // Owner - chess king / royal crown (viewBox 0 0 640 640)
  if (k === 'owner') {
    return (
      <svg className={className} viewBox="0 0 640 640" fill="currentColor" aria-hidden="true">
        <path d="M345 151.2C354.2 143.9 360 132.6 360 120C360 97.9 342.1 80 320 80C297.9 80 280 97.9 280 120C280 132.6 285.9 143.9 295 151.2L226.6 258.8C216.6 274.5 195.3 278.4 180.4 267.2L120.9 222.7C125.4 216.3 128 208.4 128 200C128 177.9 110.1 160 88 160C65.9 160 48 177.9 48 200C48 221.8 65.5 239.6 87.2 240L119.8 457.5C124.5 488.8 151.4 512 183.1 512L456.9 512C488.6 512 515.5 488.8 520.2 457.5L552.8 240C574.5 239.6 592 221.8 592 200C592 177.9 574.1 160 552 160C529.9 160 512 177.9 512 200C512 208.4 514.6 216.3 519.1 222.7L459.7 267.3C444.8 278.5 423.5 274.6 413.5 258.9L345 151.2z"/>
      </svg>
    )
  }

  // Staff - two crossed swords / sparkle
  if (k === 'staff') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7.604 4.604C9.34 2.868 10.208 2 11.286 2c1.079 0 1.947.868 3.682 2.604l4.42 4.419c1.735 1.735 2.603 2.603 2.603 3.682s-.868 1.946-2.604 3.682s-2.604 2.604-3.682 2.604c-1.079 0-1.947-.868-3.682-2.604l-4.42-4.419C5.869 10.233 5 9.365 5 8.286s.868-1.946 2.604-3.682"/>
        <path opacity=".5" d="m8.345 12.71l-5.52 5.518c-.342.343-.513.514-.616.692a1.56 1.56 0 0 0 0 1.562c.103.178.274.35.617.692s.513.514.692.617a1.56 1.56 0 0 0 1.562 0c.178-.103.35-.275.692-.617l5.518-5.519zm10.31-4.42l.373-.372c.342-.343.514-.514.617-.692a1.56 1.56 0 0 0 0-1.562c-.103-.179-.275-.35-.617-.692c-.342-.343-.514-.514-.692-.617a1.56 1.56 0 0 0-1.562 0c-.178.103-.35.274-.692.617l-.373.373z"/>
      </svg>
    )
  }

  // Verified - flower seal with checkmark
  if (k === 'verified' || k === 'badge-check') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path opacity=".5" d="M9.592 3.2a6 6 0 0 1-.495.399c-.298.2-.633.338-.985.408c-.153.03-.313.043-.632.068c-.801.064-1.202.096-1.536.214a2.71 2.71 0 0 0-1.655 1.655c-.118.334-.15.735-.214 1.536a6 6 0 0 1-.068.632c-.07.352-.208.687-.408.985c-.087.13-.191.252-.399.495c-.521.612-.782.918-.935 1.238c-.353.74-.353 1.6 0 2.34c.153.32.414.626.935 1.238c.208.243.312.365.399.495c.2.298.338.633.408.985c.03.153.043.313.068.632c.064.801.096 1.202.214 1.536a2.71 2.71 0 0 0 1.655 1.655c.334.118.735.15 1.536.214c.319.025.479.038.632.068c.352.07.687.209.985.408c.13.087.252.191.495.399c.612.521.918.782 1.238.935c.74.353 1.6.353 2.34 0c.32-.153.626-.414 1.238-.935c.243-.208.365-.312.495-.399c.298-.2.633-.338.985-.408c.153-.03.313-.043.632-.068c.801-.064 1.202-.096 1.536-.214a2.71 2.71 0 0 0 1.655-1.655c.118-.334.15-.735.214-1.536c.025-.319.038-.479.068-.632c.07-.352.209-.687.408-.985c.087-.13.191-.252.399-.495c.521-.612.782-.918.935-1.238c.353-.74.353-1.6 0-2.34c-.153-.32-.414-.626-.935-1.238a6 6 0 0 1-.399-.495a2.7 2.7 0 0 1-.408-.985a6 6 0 0 1-.068-.632c-.064-.801-.096-1.202-.214-1.536a2.71 2.71 0 0 0-1.655-1.655c-.334-.118-.735-.15-1.536-.214a6 6 0 0 1-.632-.068a2.7 2.7 0 0 1-.985-.408a6 6 0 0 1-.495-.399c-.612-.521-.918-.782-1.238-.935a2.71 2.71 0 0 0-2.34 0c-.32.153-.626.414-1.238.935"/>
        <path d="M16.374 9.863a.814.814 0 0 0-1.151-1.151l-4.85 4.85l-1.595-1.595a.814.814 0 0 0-1.151 1.151l2.17 2.17a.814.814 0 0 0 1.15 0z"/>
      </svg>
    )
  }

  // Booster - magic wand with sparkles
  if (k === 'booster' || k === 'server-booster') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path opacity=".3" d="M6.71 18.71c-.28.28-2.17.76-2.17.76s.47-1.88.76-2.17c.17-.19.42-.3.7-.3a1.003 1.003 0 0 1 .71 1.71m.7-7.88l-1.91-.82l1.97-1.97l1.44.29c-.57.83-1.08 1.7-1.5 2.5m6.58 7.67l-.82-1.91c.8-.42 1.67-.93 2.49-1.5l.29 1.44zm6-14.49S16.44 3.32 11.76 8c-1.32 1.32-2.4 3.38-2.73 4.04l2.93 2.93c.65-.32 2.71-1.4 4.04-2.73c4.68-4.68 3.99-8.23 3.99-8.23M15 11c-1.1 0-2-.9-2-2s.9-2 2-2s2 .9 2 2s-.9 2-2 2"/>
        <path d="M6 15c-.83 0-1.58.34-2.12.88C2.7 17.06 2 22 2 22s4.94-.7 6.12-1.88A2.996 2.996 0 0 0 6 15m.71 3.71c-.28.28-2.17.76-2.17.76s.47-1.88.76-2.17c.17-.19.42-.3.7-.3a1.003 1.003 0 0 1 .71 1.71m10.71-5.06c6.36-6.36 4.24-11.31 4.24-11.31S16.71.22 10.35 6.58l-2.49-.5a2.03 2.03 0 0 0-1.81.55L2 10.69l5 2.14L11.17 17l2.14 5l4.05-4.05c.47-.47.68-1.15.55-1.81zM7.41 10.83l-1.91-.82l1.97-1.97l1.44.29c-.57.83-1.08 1.7-1.5 2.5m6.58 7.67l-.82-1.91c.8-.42 1.67-.93 2.49-1.5l.29 1.44zM16 12.24c-1.32 1.32-3.38 2.4-4.04 2.73l-2.93-2.93c.32-.65 1.4-2.71 2.73-4.04c4.68-4.68 8.23-3.99 8.23-3.99s.69 3.55-3.99 8.23M15 11c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2"/>
      </svg>
    )
  }

  // OG - gate / podium with sparkle (viewBox 0 0 512 512)
  if (k === 'og') {
    return (
      <svg className={className} viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
        <path d="M41 27.7v46h430v-46zm32 64v112.5l62 20.7V91.7zm80 0v139.2l79.3 26.4c-10.4 7.5-17.3 19.7-17.3 33.4c0 21 16.1 38.5 36.5 40.7l-22.3 43.7l-58.2 9.3l41.6 41.7l-9.1 58.2l52.5-26.7l52.5 26.7l-9.1-58.2l41.6-41.7l-58.2-9.3l-22.3-43.7c20.4-2.2 36.5-19.7 36.5-40.7c0-13.7-6.9-25.9-17.3-33.4l79.3-26.4V91.7h-94v159c-2.9-.6-5.9-1-9-1s-6.1.4-9 1v-159zm224 0v133.2l62-20.7V91.7zm-121 176c12.8 0 23 10.2 23 23s-10.2 23-23 23s-23-10.2-23-23s10.2-23 23-23"/>
      </svg>
    )
  }

  // Partner - heart (viewBox 0 0 256 256)
  if (k === 'partner') {
    return (
      <svg className={className} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
        <path opacity=".2" d="M232 102c0 66-104 122-104 122S24 168 24 102a54 54 0 0 1 54-54c22.59 0 41.94 12.31 50 32c8.06-19.69 27.41-32 50-32a54 54 0 0 1 54 54"/>
        <path d="M178 40c-20.65 0-38.73 8.88-50 23.89C116.73 48.88 98.65 40 78 40a62.07 62.07 0 0 0-62 62c0 70 103.79 126.66 108.21 129a8 8 0 0 0 7.58 0C136.21 228.66 240 172 240 102a62.07 62.07 0 0 0-62-62m-50 174.8c-18.26-10.64-96-59.11-96-112.8a46.06 46.06 0 0 1 46-46c19.45 0 35.78 10.36 42.6 27a8 8 0 0 0 14.8 0c6.82-16.67 23.15-27 42.6-27a46.06 46.06 0 0 1 46 46c0 53.61-77.76 102.15-96 112.8"/>
      </svg>
    )
  }

  // Event Winner - trophy with star
  if (k === 'event-winner' || k === 'winner' || k === 'trophy') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path opacity=".5" d="M12 16c-5.76 0-6.78-5.74-6.96-10.294c-.05-1.266-.076-1.9.4-2.485c.476-.586 1.045-.682 2.184-.874A26.4 26.4 0 0 1 12 2c1.783 0 3.253.157 4.377.347c1.138.192 1.708.288 2.183.874c.476.586.451 1.219.4 2.485C18.78 10.259 17.76 16 12 16"/>
        <path d="m17.64 12.422l2.817-1.565c.752-.418 1.128-.627 1.336-.979C22 9.526 22 9.096 22 8.235v-.073c0-1.043 0-1.565-.283-1.958s-.778-.558-1.768-.888L19 5l-.017.085q-.008.283-.022.621c-.088 2.225-.377 4.733-1.32 6.716M5.04 5.706c.087 2.225.376 4.733 1.32 6.716l-2.817-1.565c-.752-.418-1.129-.627-1.336-.979S2 9.096 2 8.235v-.073c0-1.043 0-1.565.283-1.958s.778-.558 1.768-.888L5 5l.017.087q.008.281.022.62"/>
        <path fillRule="evenodd" d="M5.25 22a.75.75 0 0 1 .75-.75h12a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75" clipRule="evenodd"/>
        <path opacity=".5" d="M15.458 21.25H8.543l.297-1.75a1 1 0 0 1 .98-.804h4.36a1 1 0 0 1 .981.804z"/>
        <path d="M12 16q-.39 0-.75-.034v2.73h1.5v-2.73A8 8 0 0 1 12 16m-.854-9.977C11.526 5.34 11.716 5 12 5s.474.34.854 1.023l.098.176c.108.194.162.29.246.354c.085.064.19.088.4.135l.19.044c.738.167 1.107.25 1.195.532s-.164.577-.667 1.165l-.13.152c-.143.167-.215.25-.247.354s-.021.215 0 .438l.02.203c.076.785.114 1.178-.115 1.352c-.23.174-.576.015-1.267-.303l-.178-.082c-.197-.09-.295-.135-.399-.135s-.202.045-.399.135l-.178.082c-.691.319-1.037.477-1.267.303s-.191-.567-.115-1.352l.02-.203c.021-.223.032-.334 0-.438s-.104-.187-.247-.354l-.13-.152c-.503-.588-.755-.882-.667-1.165c.088-.282.457-.365 1.195-.532l.19-.044c.21-.047.315-.07.4-.135c.084-.064.138-.16.246-.354z"/>
      </svg>
    )
  }

  // Innovator - lightbulb (stroke-based)
  if (k === 'innovator') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7l-.7.7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0-1 3a2 2 0 0 1-4 0a3.5 3.5 0 0 0-1-3m.7 1h4.6"/>
      </svg>
    )
  }

  // Premium - crown / m-shape
  if (k === 'premium') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="m9.367 19.08l-7.025-9.04h3.836zm5.987-9.04l-3.36 10.946L8.12 10.039zm6.28 0l-7.209 9.272l2.859-9.273zM22 8.206h-4.704l-1.43-5.192h2.652a.4.4 0 0 1 .257.183zm-6.597 0h-7.27l1.833-5.18h3.995zM8.011 3.039l-1.82 5.167H2L5.128 3.32l.097-.11a.5.5 0 0 1 .16-.123a.4.4 0 0 1 .17 0z"/>
      </svg>
    )
  }

  // Donator - money / cash (viewBox 0 0 512 512)
  if (k === 'donator' || k === 'donor') {
    return (
      <svg className={className} viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">
        <path d="M327.027 65.816L229.79 128.23l9.856 5.397l86.51-55.53l146.735 83.116l-84.165 54.023l4.1 2.244v6.848l65.923-42.316l13.836 7.838l-79.76 51.195v11.723l64.633-41.487l15.127 8.57l-79.76 51.195v11.723l64.633-41.487l15.127 8.57l-79.76 51.195v11.723l100.033-64.21l-24.828-14.062l24.827-15.937l-24.828-14.064l24.827-15.937l-23.537-13.333l23.842-15.305zm31.067 44.74c-21.038 10.556-49.06 12.342-68.79 4.383l-38.57 24.757l126.903 69.47l36.582-23.48c-14.41-11.376-13.21-28.35 2.942-41.67zM227.504 147.5l-70.688 46.094l135.61 78.066l1.33-.85c2.5-1.61 6.03-3.89 10.242-6.613c8.42-5.443 19.563-12.66 30.674-19.86c16.002-10.37 24.248-15.72 31.916-20.694zm115.467 1.17a8.583 14.437 82.068 0 1 .003 0a8.583 14.437 82.068 0 1 8.32 1.945a8.583 14.437 82.068 0 1-.87 12.282a8.583 14.437 82.068 0 1-20.273 1.29a8.583 14.437 82.068 0 1 .87-12.28a8.583 14.437 82.068 0 1 11.95-3.237m-218.423 47.115L19.143 263.44l23.537 13.333l-23.842 15.305l24.828 14.063l-24.828 15.938l24.828 14.063l-24.828 15.938l166.135 94.106L285.277 381.8v-11.72l-99.433 63.824L39.11 350.787l14.255-9.15l131.608 74.547L285.277 351.8v-11.72l-99.433 63.824L39.11 320.787l14.255-9.15l131.608 74.547L285.277 321.8v-11.72l-99.433 63.824L39.11 290.787l13.27-8.52l132.9 75.28l99.997-64.188v-5.05l-5.48-3.154l-93.65 60.11l-146.73-83.116l94.76-60.824l-9.63-5.543zm20.46 11.78l-46.92 30.115c14.41 11.374 13.21 28.348-2.942 41.67l59.068 33.46c21.037-10.557 49.057-12.342 68.787-4.384l45.965-29.504l-123.96-71.358zm229.817 32.19c-8.044 5.217-15.138 9.822-30.363 19.688a36222 36222 0 0 1-30.69 19.873c-4.217 2.725-7.755 5.01-10.278 6.632c-.09.06-.127.08-.215.137v85.924l71.547-48.088zm-200.99 17.48a8.583 14.437 82.068 0 1 8.32 1.947a8.583 14.437 82.068 0 1-.87 12.28a8.583 14.437 82.068 0 1-20.27 1.29a8.583 14.437 82.068 0 1 .87-12.28a8.583 14.437 82.068 0 1 11.95-3.236z"/>
      </svg>
    )
  }

  // Bug Hunter - bug
  if (k === 'bug-hunter' || k === 'bug') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19 8h-1.81a5.985 5.985 0 0 0-1.82-1.96l.93-.93a.996.996 0 1 0-1.41-1.41l-1.47 1.47C12.96 5.06 12.49 5 12 5s-.96.06-1.41.17L9.11 3.7A.996.996 0 1 0 7.7 5.11l.92.93C7.88 6.55 7.26 7.22 6.81 8H5c-.55 0-1 .45-1 1s.45 1 1 1h1.09c-.05.33-.09.66-.09 1v1H5c-.55 0-1 .45-1 1s.45 1 1 1h1v1c0 .34.04.67.09 1H5c-.55 0-1 .45-1 1s.45 1 1 1h1.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H19c.55 0 1-.45 1-1s-.45-1-1-1h-1.09c.05-.33.09-.66.09-1v-1h1c.55 0 1-.45 1-1s-.45-1-1-1h-1v-1c0-.34-.04-.67-.09-1H19c.55 0 1-.45 1-1s-.45-1-1-1m-6 8h-2c-.55 0-1-.45-1-1s.45-1 1-1h2c.55 0 1 .45 1 1s-.45 1-1 1m0-4h-2c-.55 0-1-.45-1-1s.45-1 1-1h2c.55 0 1 .45 1 1s-.45 1-1 1"/>
      </svg>
    )
  }

  // Gifter - gift box (viewBox 2 2 16 16)
  if (k === 'gifter' || k === 'gift') {
    return (
      <svg className={className} viewBox="2 2 16 16" fill="currentColor" aria-hidden="true">
        <g>
          <path fillRule="evenodd" d="M14 6a2.5 2.5 0 0 0-4-3a2.5 2.5 0 0 0-4 3H3.25C2.56 6 2 6.56 2 7.25v.5C2 8.44 2.56 9 3.25 9h6V6h1.5v3h6C17.44 9 18 8.44 18 7.75v-.5C18 6.56 17.44 6 16.75 6zm-1-1.5a1 1 0 0 1-1 1h-1v-1a1 1 0 1 1 2 0m-6 0a1 1 0 0 0 1 1h1v-1a1 1 0 0 0-2 0" clipRule="evenodd"/>
          <path d="M9.25 10.5H3v4.75A2.75 2.75 0 0 0 5.75 18h3.5zm1.5 7.5v-7.5H17v4.75A2.75 2.75 0 0 1 14.25 18z"/>
        </g>
      </svg>
    )
  }

  // Bitcoin - dimensional orange disc with glassy top sheen + crisp ₿
  if (k === 'btc' || k === 'bitcoin') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="btcBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FBBF44"/><stop offset="55%" stopColor="#F7931A"/><stop offset="100%" stopColor="#B5660A"/></linearGradient>
          <radialGradient id="btcSheen" cx="50%" cy="0%" r="65%"><stop offset="0%" stopColor="#fff" stopOpacity=".55"/><stop offset="100%" stopColor="#fff" stopOpacity="0"/></radialGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#btcBg)"/>
        <circle cx="12" cy="12" r="11" fill="url(#btcSheen)"/>
        <circle cx="12" cy="12" r="10.6" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".4"/>
        <circle cx="12" cy="12" r="11" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth=".4"/>
        <g style={{ filter: 'drop-shadow(0 .5px .5px rgba(0,0,0,.25))' }}>
          <path fill="#fff" d="M15.93 10.79c.22-1.45-.89-2.23-2.41-2.75l.49-1.97-1.2-.3-.48 1.92q-.47-.12-.96-.22l.48-1.93-1.2-.3-.49 1.97q-.39-.09-.76-.17l-1.66-.41-.32 1.28s.89.2.87.22c.49.12.58.45.56.7l-1.37 5.49q-.09.21-.4.16c.02.02-.87-.22-.87-.22l-.6 1.38 1.57.39q.43.11.86.22l-.5 1.99 1.2.3.49-1.97.96.25-.49 1.97 1.2.3.5-1.99c2.05.39 3.6.23 4.25-1.62.52-1.49-.03-2.36-1.11-2.92.79-.18 1.39-.7 1.55-1.77zm-2.76 3.93c-.37 1.49-2.88.69-3.7.48l.66-2.65c.82.21 3.42.61 3.04 2.17m.37-3.96c-.34 1.36-2.43.66-3.11.49l.6-2.39c.69.17 2.88.48 2.51 1.9z"/>
        </g>
      </svg>
    )
  }

  // Ethereum - dimensional blue disc with crisp octahedron glyph
  if (k === 'eth' || k === 'ethereum') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="ethBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9DB4FF"/><stop offset="55%" stopColor="#627EEA"/><stop offset="100%" stopColor="#3653BA"/></linearGradient>
          <radialGradient id="ethSheen" cx="50%" cy="0%" r="65%"><stop offset="0%" stopColor="#fff" stopOpacity=".55"/><stop offset="100%" stopColor="#fff" stopOpacity="0"/></radialGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#ethBg)"/>
        <circle cx="12" cy="12" r="11" fill="url(#ethSheen)"/>
        <circle cx="12" cy="12" r="10.6" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".4"/>
        <circle cx="12" cy="12" r="11" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth=".4"/>
        <g style={{ filter: 'drop-shadow(0 .5px .5px rgba(0,0,0,.25))' }}>
          <path fill="#fff" fillOpacity=".75" d="M12 4.5v5.18l4.62 2.07z"/>
          <path fill="#fff" d="M12 4.5L7.38 11.75 12 9.68z"/>
          <path fill="#fff" fillOpacity=".75" d="M12 15.74v3.76l4.62-6.4z"/>
          <path fill="#fff" d="M12 19.5v-3.77L7.38 13.1z"/>
          <path fill="#fff" fillOpacity=".4" d="M12 14.85l4.62-2.73L12 10.05z"/>
          <path fill="#fff" fillOpacity=".75" d="M7.38 12.12L12 14.85v-4.8z"/>
        </g>
      </svg>
    )
  }

  // Tether (USDT) - dimensional green disc with crisp ₮
  if (k === 'usdt' || k === 'tether') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="usdtBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5BD4A6"/><stop offset="55%" stopColor="#26A17B"/><stop offset="100%" stopColor="#15694F"/></linearGradient>
          <radialGradient id="usdtSheen" cx="50%" cy="0%" r="65%"><stop offset="0%" stopColor="#fff" stopOpacity=".55"/><stop offset="100%" stopColor="#fff" stopOpacity="0"/></radialGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#usdtBg)"/>
        <circle cx="12" cy="12" r="11" fill="url(#usdtSheen)"/>
        <circle cx="12" cy="12" r="10.6" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".4"/>
        <circle cx="12" cy="12" r="11" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth=".4"/>
        <g style={{ filter: 'drop-shadow(0 .5px .5px rgba(0,0,0,.25))' }}>
          <path fill="#fff" d="M13.45 12.83v-1.7h3.31V8.55H7.24v2.58H10.55v1.7c-2.69.13-4.71.66-4.71 1.3 0 .64 2.02 1.17 4.71 1.3v5.45h2.9v-5.45c2.69-.13 4.71-.66 4.71-1.3 0-.64-2.02-1.17-4.71-1.3zm0 2.21q-.1.01-1.25.02c-.65 0-1.11-.02-1.27-.02-2.52-.11-4.4-.55-4.4-1.07 0-.53 1.88-.97 4.4-1.08v1.72c.17.01.65.04 1.28.04.78 0 1.16-.03 1.24-.04v-1.72c2.51.11 4.39.55 4.39 1.08 0 .53-1.88.96-4.39 1.07z"/>
        </g>
      </svg>
    )
  }

  // Litecoin - dimensional steel-blue disc with crisp Ł
  if (k === 'ltc' || k === 'litecoin') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="ltcBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#88A6D8"/><stop offset="55%" stopColor="#345D9D"/><stop offset="100%" stopColor="#1A3568"/></linearGradient>
          <radialGradient id="ltcSheen" cx="50%" cy="0%" r="65%"><stop offset="0%" stopColor="#fff" stopOpacity=".55"/><stop offset="100%" stopColor="#fff" stopOpacity="0"/></radialGradient>
        </defs>
        <circle cx="12" cy="12" r="11" fill="url(#ltcBg)"/>
        <circle cx="12" cy="12" r="11" fill="url(#ltcSheen)"/>
        <circle cx="12" cy="12" r="10.6" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".4"/>
        <circle cx="12" cy="12" r="11" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth=".4"/>
        <g style={{ filter: 'drop-shadow(0 .5px .5px rgba(0,0,0,.25))' }}>
          <path fill="#fff" d="M9.55 17.65l1.13-4.27 1.92-.7.46-1.74-.01-.04-1.89.69L12.5 6.5h-3.74l-1.78 6.74-1.46.54-.45 1.72 1.45-.54-1.04 3.92h11.88l.79-3.22z"/>
        </g>
      </svg>
    )
  }

  // Fallback for any unknown icon - generic star
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  )
}

// Badge name tooltip that escapes parent stacking contexts via a portal,
// so it always floats above the avatar / card content on hover.
function BadgeTooltip({
  label, glowColor, children,
}: {
  label: string; glowColor: string; children: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLSpanElement | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const update = () => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ x: r.left + r.width / 2, y: r.top })
  }

  return (
    <>
      <span
        ref={ref}
        className="group relative inline-flex"
        onMouseEnter={() => { update(); setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
      >
        {children}
      </span>
      {mounted && hovered && coords ? createPortal(
        <span
          className="pointer-events-none fixed z-[2147483646] -translate-x-1/2 -translate-y-full rounded-2xl px-3 py-1 text-[11px] font-semibold"
          style={{
            left: coords.x,
            top: coords.y - 10,
            backgroundColor: 'rgba(11,11,18,0.92)',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: `0 0 16px ${glowColor}1f`,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>,
        document.body,
      ) : null}
    </>
  )
}

function _OldBadgeIconRefs({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const k = (name || '').toLowerCase()
  const wrap = (children: React.ReactNode) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
  const filled = (path: string) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  )

  switch (k) {
    case 'badge-check':
    case 'verified':
      return filled('M12 1.5l1.78 1.36a2.5 2.5 0 002.27.42l2.18-.62 1.07 1.99a2.5 2.5 0 001.6 1.21l2.16.51-.43 2.2a2.5 2.5 0 00.34 1.85l1.21 1.86-1.86 1.21a2.5 2.5 0 00-.94 1.6l-.34 2.2-2.2.43a2.5 2.5 0 00-1.6.94L17.4 20l-2.16-.51a2.5 2.5 0 00-1.85.34L11.5 21l-1.36-1.78a2.5 2.5 0 00-1.85-.94l-2.2-.34-.43-2.2a2.5 2.5 0 00-.94-1.6L2.74 12.86l1.21-1.86a2.5 2.5 0 00.34-1.85l-.43-2.2 2.16-.51a2.5 2.5 0 001.6-1.21L8.69 3.24l2.18.62a2.5 2.5 0 002.27-.42L12 1.5zm4.5 8.2L11 15.2 7.5 11.7l1.4-1.4 2.1 2.1L15.1 8.3l1.4 1.4z')
    case 'shield':
    case 'staff':
      return filled('M12 1.5L3 5v6c0 5.4 3.84 10.4 9 11.5 5.16-1.1 9-6.1 9-11.5V5L12 1.5z')
    case 'admin':
    case 'administrator':
      return filled('M12 1.5L3 5v6c0 5.4 3.84 10.4 9 11.5 5.16-1.1 9-6.1 9-11.5V5L12 1.5zm0 3.7l5 1.95v3.85c0 3.7-2.5 7.05-5 7.95-2.5-.9-5-4.25-5-7.95V7.15L12 5.2zm-1 4.05L9.5 11l1.5 1.5 3-3-1-1L11 10.25 10.5 9.75z')
    case 'crown':
    case 'og':
      return filled('M2.5 7.5l3 8h13l3-8-5 3.5-2.5-6-3 5L8 7l-2.5 4.5-3-4zM4 17h16v3H4v-3zm2.5-9.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm17 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM12 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm3 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z')
    case 'premium':
    case 'gem':
      return filled('M6.5 2h11l4.5 6.5L12 22 .5 8.5 6.5 2zm.5 2L4.5 7l4.5 1L7 4zm5.5 0L10.5 8h3L12 4zm5 0l-2 4 4.5-1L17.5 4zM4 9.5L11 19l-3-9.5H4zm6 0l2 9.5 2-9.5h-4zm6 0L13 19l7-9.5h-4z')
    case 'rocket':
    case 'early':
      return filled('M13.5 1.5C18 1.5 22 5.5 22 10l-3 3-7-7 1.5-4.5zM4 15l5-5 5 5-3 3-3 3-2-3-2-3zM2 22l4-1 1-4-5 5z')
    case 'bug':
      return filled('M14 4l2-2 1.5 1.5L15.5 5.5c.7.5 1.3 1.2 1.7 2H21v2h-3.05c.05.33.05.67.05 1v1H21v2h-2v.5c0 .5-.05 1-.15 1.5H21v2h-3.05c-1 2-3 3.5-5.45 3.5h-1c-2.45 0-4.45-1.5-5.45-3.5H3v-2h2.15c-.1-.5-.15-1-.15-1.5V13.5H3v-2h2v-1c0-.33 0-.67.05-1H3v-2h3.8c.4-.8 1-1.5 1.7-2L6.5 3.5 8 2l2 2c.65-.15 1.3-.25 2-.25s1.35.1 2 .25z')
    case 'gift':
    case 'gifter':
      return filled('M20 6h-3.4c.4-.5.4-1.5 0-2-.85-1-2.4-1-3.6 0L12 5l-1-1c-1.2-1-2.75-1-3.6 0-.4.5-.4 1.5 0 2H4c-1.1 0-2 .9-2 2v3h2v9c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-9h2V8c0-1.1-.9-2-2-2zM10 19H6v-9h4v9zm0-11H4V8l4 .5h2v.5zm4-2.5c.3-.4 1-.4 1.5 0s.5.85 0 1.25l-1.5.75-.5-1zm0 13.5h-2v-9h2v9zm4 0h-2v-9h2v9zm2-11h-2.5L18 8h2v.5z')
    case 'heart':
    case 'donor':
    case 'donator':
      return filled('M12 21l-1.45-1.32C5.4 14.94 2 11.9 2 8.18 2 5.42 4.42 3 7.18 3c1.66 0 3.27.79 4.32 2.04C12.55 3.79 14.16 3 15.82 3 18.58 3 21 5.42 21 8.18c0 3.72-3.4 6.76-8.55 11.5L12 21z')
    case 'helper':
    case 'hand':
      return filled('M9 11V4.5a1.5 1.5 0 113 0V11h.5V3a1.5 1.5 0 113 0v8h.5V4.5a1.5 1.5 0 113 0V13a7 7 0 01-7 7h-1c-3.87 0-7-3.13-7-7v-2.5a1.5 1.5 0 113 0V13l1-1V8.5a1.5 1.5 0 113 0V11h.5z')
    case 'image':
    case 'image-host':
      return filled('M4 3h16c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2zm1 4a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0zm-1 12h16v-3l-4.5-4.5L9 18 6 15l-2 2v2z')
    case 'globe':
    case 'domain':
      return filled('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-.65.08-1.27.22-1.87l4.78 4.78V16c0 1.1.9 2 2 2v1.93C7.06 19.43 4 16.07 4 12zm15.5 6.5c-.36-1.18-1.42-2-2.5-2h-1v-3c0-.55-.45-1-1-1H9v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.4C17.94 5.65 20 8.59 20 12c0 2.18-.83 4.18-2.5 5.5z')
    case 'flame':
    case 'booster':
    case 'server-booster':
      return filled('M12 2c1 3 5 4 5 9.5 0 4.7-3 7.5-5 7.5s-5-2.8-5-7.5C7 8 9 7 9 4c0 1.5 1 3 3 4 0-2 1-4 0-6zm0 13a3 3 0 003-3c0-1.5-1.5-2-1.5-4-1 1-3 1-3 3 0 1 1 1.5 1 2.5-1.5 0-2 1-2 2 0 1 1 1.5 2 1.5z')
    case 'trophy':
    case 'winner':
    case 'first':
      return filled('M19 5h2v2a4 4 0 01-4 4h-.18A6 6 0 0114 14.92V17h3v3H7v-3h3v-2.08A6 6 0 017.18 11H7a4 4 0 01-4-4V5h2V3h14v2zM5 7a2 2 0 002 2V7H5zm14 2a2 2 0 002-2h-2v2z')
    case 'medal':
    case 'second':
    case 'third':
    case 'bronze':
      return filled('M7 2h10l-2.5 6H9.5L7 2zm5 8a6 6 0 110 12 6 6 0 010-12zm0 2.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z')
    case 'snowflake':
    case 'snow':
    case 'christmas':
      return filled('M11 2h2v3.59l1.3-1.3 1.4 1.42L13 8.41V11h2.59l3.7-3.7 1.41 1.42-1.3 1.3H22v2h-2.59l1.3 1.3-1.42 1.42L15.59 13H13v2.59l3.7 3.7-1.42 1.41-1.3-1.3V22h-2v-2.59l-1.3 1.3-1.42-1.41 3.72-3.7H11v-2.59L7.3 16.71 5.88 15.3l1.3-1.3H4.59v-2H7l-1.3-1.3 1.41-1.42 3.7 3.72H11V8.41L7.29 4.71 8.7 3.3 11 5.59V2z')
    case 'rabbit':
    case 'easter':
      return filled('M8.5 2c1.4 0 2.5 1.1 2.5 2.5v2c.65-.3 1.3-.5 2-.5s1.35.2 2 .5v-2C15 3.1 16.1 2 17.5 2s2.5 1.1 2.5 2.5V8c1.2 1.2 2 3 2 5 0 4.4-3.6 8-8 8h-4c-4.4 0-8-3.6-8-8 0-2 .8-3.8 2-5V4.5C4 3.1 5.1 2 6.5 2zm.5 12a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2zm-3 4l-2 4h4l-2-4z')
    case 'egg':
      return filled('M12 2c-4 0-8 5-8 13 0 4.4 3.6 7 8 7s8-2.6 8-7c0-8-4-13-8-13z')
    case 'pumpkin':
    case 'halloween':
      return filled('M13.5 4l1.5-3 .5 3.2c.5-.13 1-.2 1.5-.2 3 0 5.5 4 5.5 8s-2.5 8-5.5 8h-9C5 20 2.5 16 2.5 12S5 4 8 4c.5 0 1 .07 1.5.2L11 3l1 1.5c.5-.3 1-.5 1.5-.5zm-7 7l1 4-1-1-1 1 1-4zm5 0l1 4-1-1-1 1 1-4zm5 0l1 4-1-1-1 1 1-4z')
    case 'ghost':
      return filled('M12 2C7.58 2 4 5.58 4 10v10.5c0 .83.67 1.5 1.5 1.5.4 0 .78-.16 1.06-.44L8 20l1.94 1.56c.3.24.66.38 1.06.38s.76-.14 1.06-.38L14 20l1.94 1.56c.28.28.66.44 1.06.44.83 0 1.5-.67 1.5-1.5V10c0-4.42-3.58-8-8-8zm-2 8a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm4 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3z')
    case 'flask':
    case 'beta':
    case 'beta-tester':
      return filled('M9 2v6.5L3.4 17.6c-.92 1.5.16 3.4 1.93 3.4h13.34c1.77 0 2.85-1.9 1.93-3.4L15 8.5V2H9zm2 2h2v5h-2V4zm-3.7 11h9.4l1.85 3H5.45l1.85-3z')
    case 'palette':
    case 'artist':
      return filled('M12 2c5.5 0 10 4 10 9 0 3.3-2.7 6-6 6h-2c-1.1 0-2 .9-2 2 0 .5.2.9.5 1.3.3.4.5.7.5 1.2 0 1-.8 1.5-2 1.5C7 23 2 18 2 12S6.5 2 12 2zM5.5 11.5a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zm3-4a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zm5 0a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0zm3 4a1.5 1.5 0 103 0 1.5 1.5 0 00-3 0z')
    case 'code':
    case 'developer':
      return filled('M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6L14.6 7.4 16 6l6 6-6 6-1.4-1.4z')
    case 'wrench':
    case 'moderator':
      return filled('M22.7 19.3l-8.4-8.4c.5-1.5.2-3.2-1-4.4-1.3-1.3-3.2-1.6-4.8-.9l3.4 3.4-2.4 2.4-3.4-3.4c-.7 1.6-.4 3.5.9 4.8 1.2 1.2 2.9 1.5 4.4 1l8.4 8.4c.4.4 1 .4 1.4 0l1.5-1.5c.4-.4.4-1 0-1.4z')
    case 'sparkles':
    case 'contributor':
    case 'star':
      return filled('M12 2l2.39 7.16L22 9.27l-5.6 4.84L18.18 22 12 17.77 5.82 22l1.78-7.89L2 9.27l7.61-.11L12 2zm6.5 13l1.07 3.27L22 18.5l-2.43 1.23L18.5 23l-1.07-3.27L15 18.5l2.43-1.23L18.5 14zM6 13l.8 2.46L9 16.25l-2.2.79L6 19.5l-.8-2.46L3 16.25l2.2-.79L6 13z')
    case 'million':
      return filled('M12 2c5.52 0 10 4.48 10 10s-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2zm-3 6v2h2v6H8v2h8v-2h-3v-8H9zm6 0v8h2V8h-2z')
    default:
      return filled('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z')
  }
}

const fallbackBadgeIcons: Record<string, string> = {
  crown: '👑',
  'badge-check': '✓',
  sparkles: '✨',
  rocket: '🚀',
  star: '⭐',
  verified: '✓',
  og: '⭐',
  premium: '💎',
  early: '⚡',
  staff: '🛡️',
  shield: '🛡️',
  bug: '🐛',
  heart: '❤️',
  gift: '🎁',
  image: '🖼️',
  globe: '🌐',
  trophy: '🏆',
  medal: '🥇',
  silver: '🥈',
  bronze: '🥉',
  egg: '🥚',
  rabbit: '🐰',
  snow: '❄️',
  snowflake: '❄️',
  pumpkin: '🎃',
  ghost: '👻',
  flame: '🔥',
  flask: '🧪',
  palette: '🎨',
  code: '⌨️',
  wrench: '🔧',
  info: 'ℹ️',
  hand: '🤝',
  helper: '🤝',
  moderator: '🔧',
  admin: '⚔️',
  contributor: '✨',
  donator: '❤️',
  donor: '❤️',
  gifter: '🎁',
  artist: '🎨',
  developer: '⌨️',
  beta: '🧪',
  winner: '🏆',
  first: '🥇',
  second: '🥈',
  third: '🥉',
  million: '💯',
}

// Convert bio markdown → safe HTML.
// Supports: **bold** *italic* __underline__ ~~strike~~ [text](url) # ## ### #### <left>/<center>/<right>
function renderBioMarkdown(raw: string): string {
  // Escape HTML first
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Restore alignment tags (we escaped < and > above so re-allow our tags)
  s = s
    .replace(/&lt;left&gt;/gi, '<div style="text-align:left">')
    .replace(/&lt;\/left&gt;/gi, '</div>')
    .replace(/&lt;center&gt;/gi, '<div style="text-align:center">')
    .replace(/&lt;\/center&gt;/gi, '</div>')
    .replace(/&lt;right&gt;/gi, '<div style="text-align:right">')
    .replace(/&lt;\/right&gt;/gi, '</div>')

  // Headers (line-start)
  s = s.replace(/^#### (.+)$/gm, '<h4 style="font-size:1.05em;font-weight:600;margin:0.4em 0">$1</h4>')
  s = s.replace(/^### (.+)$/gm, '<h3 style="font-size:1.15em;font-weight:600;margin:0.4em 0">$1</h3>')
  s = s.replace(/^## (.+)$/gm, '<h2 style="font-size:1.3em;font-weight:700;margin:0.5em 0">$1</h2>')
  s = s.replace(/^# (.+)$/gm, '<h1 style="font-size:1.5em;font-weight:700;margin:0.5em 0">$1</h1>')

  // Inline formatting (order matters: longer markers first)
  s = s.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  s = s.replace(/(?<!\*)\*([^\*]+)\*(?!\*)/g, '<em>$1</em>')

  // Links: [text](url) - only allow http(s):// and mailto:.
  // Escape any quotes in the URL to prevent attribute-injection XSS - the
  // input was already HTML-escaped for `<` and `>` but quotes were not, so a
  // URL like `https://x"onload=...` could break out of the href="" attribute.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, url: string) => {
    const isSafeProtocol = /^(https?:\/\/|mailto:)/i.test(url)
    const safe = (isSafeProtocol ? url : '#').replace(/"/g, '%22').replace(/'/g, '%27')
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">${text}</a>`
  })

  // Newlines → <br>
  s = s.replace(/\n/g, '<br />')

  return s
}

function TypingBio({ texts, color, speed }: { texts: string[]; color: string; speed: number }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [displayText, setDisplayText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!texts.length) return
    const currentText = texts[currentIndex]
    const tick = isDeleting ? Math.max(16, Math.floor(speed * 0.5)) : speed

    if (!isDeleting && displayText === currentText) {
      const timeout = window.setTimeout(() => setIsDeleting(true), Math.max(300, speed * 6))
      return () => window.clearTimeout(timeout)
    }
    if (isDeleting && displayText === '') {
      const timeout = window.setTimeout(() => {
        setIsDeleting(false)
        setCurrentIndex((prev) => (prev + 1) % texts.length)
      }, Math.max(120, speed * 2))
      return () => window.clearTimeout(timeout)
    }

    const timeout = window.setTimeout(() => {
      setDisplayText((current) => isDeleting ? currentText.substring(0, current.length - 1) : currentText.substring(0, current.length + 1))
    }, tick)
    return () => window.clearTimeout(timeout)
  }, [currentIndex, displayText, isDeleting, speed, texts])

  if (!texts.length) return null
  return (
    <span style={{ color }}>
      {displayText}
      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
    </span>
  )
}

function AnimatedViewCount({ target, animate }: { target: number; animate: boolean }) {
  const [count, setCount] = useState(animate ? 0 : target)
  const started = useRef(false)

  useEffect(() => {
    if (!animate || started.current) return
    started.current = true
    if (target === 0) return
    const duration = Math.min(1800, Math.max(600, target * 0.8))
    const startTime = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setCount(Math.round(eased * target))
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [animate, target])

  return <>{count.toLocaleString()}</>
}

function getViewsPositionStyle(pos: string, isMobile: boolean, topClearance?: number): CSSProperties {
  const spacing = isMobile ? 12 : 16
  // For top positions, use topClearance (to clear avatar overlap) or default spacing
  const topVal = topClearance != null ? topClearance : spacing
  switch (pos) {
    case 'top-left':    return { left: spacing, top: topVal }
    case 'bottom-left': return { left: spacing, bottom: spacing }
    case 'bottom-right':return { right: spacing, bottom: spacing }
    default:            return { right: spacing, top: topVal } // top-right
  }
}

function formatProfileUid(profile: Profile) {
  // Use the actual uid column from database
  const uid = (profile as any).uid
  if (uid) return `UID ${uid.toLocaleString()}`
  return 'UID 1'
}

function safeButtonHref(url: string | null | undefined): string {
  if (!url) return '#'
  const stripped = url.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
  if (stripped.startsWith('javascript:') || stripped.startsWith('data:') || stripped.startsWith('vbscript:')) return '#'
  if (/^https?:\/\//i.test(url)) return url
  return `https://${url}`
}

function buildSocialHref(platform: string, url: string): string {
  if (!url) return '#'
  // Block dangerous protocols regardless of casing or whitespace
  const stripped = url.replace(/[\s\u0000-\u001f]/g, '').toLowerCase()
  if (stripped.startsWith('javascript:') || stripped.startsWith('data:') || stripped.startsWith('vbscript:')) return '#'
  if (/^https?:\/\//i.test(url)) return url
  // email platform: bare address → mailto:
  if (platform === 'email') return `mailto:${url}`
  // Telegram: bare username or @username → https://t.me/username
  if (platform === 'telegram') {
    const clean = url.replace(/^@/, '').replace(/^t\.me\/?/, '')
    return `https://t.me/${clean}`
  }
  return `https://${url}`
}

export function GunsProfile({ profile, socialLinks, badges, badgeLoadout = [], titleLoadout = [], customButtons = [], musicTracks = [], previewMode = false }: GunsProfileProps) {
  const enterConfig = profile as Profile & Record<string, any>
  // Use the enter_enabled field to determine if splash screen should show
  const enterEnabled = enterConfig.enter_enabled !== false && !previewMode
  const [entered, setEntered] = useState(!enterEnabled)
  const [splashFading, setSplashFading] = useState(false)
  const [contentVisible, setContentVisible] = useState(!enterEnabled)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [showUid, setShowUid] = useState(false)
  // Coords for the UID tooltip - portaled to document.body so it can never
  // be trapped behind the avatar's stacking context.
  const uidTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [uidCoords, setUidCoords] = useState<{ x: number; y: number } | null>(null)
  const showUidTooltip = () => {
    const el = uidTriggerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setUidCoords({ x: r.left + r.width / 2, y: r.top })
    }
    setShowUid(true)
  }
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [volume, setVolume] = useState(() => {
    const v = (profile as any).music_volume
    return typeof v === 'number' ? Math.max(0, Math.min(1, v / 100)) : 0.8
  })
  const [showVolumePanel, setShowVolumePanel] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const p = profile as Profile & Record<string, any>
  const accentColor = profile.accent_color || '#a855f7'
  const textColor = profile.text_color || '#ffffff'
  const iconColor = profile.icon_color || accentColor
  const bgColor = profile.background_color || '#09090f'
  const glowColor = profile.glow_color || accentColor
  const glowIntensity = p.glow_intensity ?? 50
  // Multi-font resolution. The user can upload up to 4 named fonts and
  // assign each text element (display name, @username, bio, music panel) to
  // any one of them - or to slot 0 (the system default fallback). Each
  // font slot becomes a unique @font-face name so multiple fonts can render
  // side-by-side without colliding.
  const fontSlots = [
    (p as any).font_1_url || (p as any).custom_font_url, // legacy fallback
    (p as any).font_2_url,
    (p as any).font_3_url,
    (p as any).font_4_url,
  ] as Array<string | null | undefined>
  const baseFontFallback = getResolvedFontFamily(profile.font_family, null)
  const slotFamily = (slot: number) => {
    if (!slot || slot < 1 || slot > 4) return baseFontFallback
    const url = fontSlots[slot - 1]
    if (!url) return baseFontFallback
    return `"ProfileCustomFont${slot}", ${baseFontFallback}`
  }
  // Backward-compat: existing profiles use font_apply_* booleans + a single
  // font_url. If a per-element slot isn't set (= 0), fall back to the legacy
  // toggle pattern so saved profiles render the same as before.
  const legacyFamily = getResolvedFontFamily(profile.font_family, profile.custom_font_url)
  const customFontUrl = (profile as any).custom_font_url
  const legacyFor = (key: 'displayname' | 'username' | 'bio' | 'music') => {
    const flag = (p as any)[`font_apply_${key}`]
    if (!customFontUrl) return baseFontFallback
    return (flag ?? true) ? legacyFamily : baseFontFallback
  }
  // font_slot_username drives the big username line at the top. The
  // separate "displayname" slot is left in the schema for backward compat
  // but the matching DOM element was removed when @handle was promoted.
  const fontApplyUsername    = (p as any).font_slot_username    ? slotFamily((p as any).font_slot_username)    : legacyFor('username')
  const fontApplyBio         = (p as any).font_slot_bio         ? slotFamily((p as any).font_slot_bio)         : legacyFor('bio')
  const fontApplyMusic       = (p as any).font_slot_music       ? slotFamily((p as any).font_slot_music)       : legacyFor('music')
  const fontFamily = legacyFamily
  // Per-element color overrides (NULL = inherit base). `display_name_color`
  // drives the big username line; `username_handle_color` is preserved in
  // the schema but unused now that the @handle is no longer a separate line.
  const displayNameColorOverride = p.display_name_color || null
  const bioColor                 = p.bio_color || textColor
  const locationColor            = p.location_color || textColor
  const cardTextColor            = p.card_text_color || textColor
  const musicTextColor           = p.music_text_color || textColor
  const usernameText = profile.username || 'profile'
  const displayName = (profile.display_name || '').trim() || profile.username
  const showBadges = profile.show_badges !== false
  const hoverEffect = p.hover_effect || 'none'
  const hoverEffectColor = p.hover_effect_color || accentColor
  const usernameEffect = p.username_effect || 'none'
  const entranceAnimation = p.entrance_animation || 'fade'
  const avatarPosition = p.avatar_position === 'left' ? 'left' : 'center'
  const avatarPlacement = p.avatar_placement === 'inside' ? 'inside' : 'outside'
  const showAvatar = p.show_avatar !== false
  const avatarShapeStyle = getAvatarShapeStyle(p.avatar_shape)
  const showIdentity = p.show_name !== false
  const typingBio = p.typing_bio || false
  const bioTexts: string[] = Array.isArray(p.bio_texts) ? p.bio_texts : []
  const typingSpeed = p.typing_speed ?? 80
  const panelSize = p.panel_size || 'medium'
  const cursorEffect = p.cursor_effect || 'none'
  const cursorColor = p.cursor_color || accentColor
  const cursorClickEffect = p.cursor_click_effect || 'none'
  const cursorClickColor = p.cursor_click_color || cursorColor
  const customCursorUrl = p.custom_cursor_url || ''
  const hoverCursorUrl = p.custom_cursor_hover_url || ''
  const monochromeIcons = p.monochrome_icons || false
  const noBgIcons = (profile as any).social_icons_no_background === true
  const socialIconClass = noBgIcons ? 'h-7 w-7' : 'h-5 w-5'
  const socialIconClassSmall = noBgIcons ? 'h-6 w-6' : 'h-4 w-4'
  const swapBoxColors = p.swap_box_colors || false
  const volumeControl = p.volume_control !== false
  const backgroundEffect = p.background_effect || 'none'
  const viewsLocationPosition = p.views_location_position || 'top-right'
  const animateViewCount = p.animate_view_count === true
  const viewsBadgeBackground = p.views_badge_background === true
  const uidText = formatProfileUid(profile)
  // Custom cursor image stays visible alongside any effect except 'cat' (own
  // sprite) and 'splash' (fluid sim takes over the cursor surface).
  const useCustomCursorOverlay = cursorEffect !== 'cat' && cursorEffect !== 'splash' && Boolean(customCursorUrl || hoverCursorUrl)
  const layoutMode = (['modern', 'portfolio', 'minimal', 'banner'] as const).includes(p.layout_mode as any)
    ? (p.layout_mode as 'modern' | 'portfolio' | 'minimal' | 'banner')
    : 'default'

  useEffect(() => {
    const syncMobile = () => setIsMobile(window.innerWidth < 640)
    syncMobile()
    window.addEventListener('resize', syncMobile)
    return () => window.removeEventListener('resize', syncMobile)
  }, [])
  const enterTitle = (p.enter_title || displayName || usernameText || '').trim() || usernameText
  const enterSubtitle = (p.enter_subtitle || 'Click anywhere to enter').trim() || 'Click anywhere to enter'
  const showEnterProfile = p.enter_show_profile !== false && showAvatar
  const showEnterTitle = p.enter_show_title !== false && showIdentity
  const showEnterSubtitle = p.enter_show_subtitle !== false

  const playlist = useMemo<MusicTrack[]>(() => {
    // Use musicTracks from music_history if available, capped at 3 (or 5 for
    // premium - the cap is enforced server-side, this just guards the UI).
    let base: MusicTrack[] = []
    if (musicTracks.length > 0) {
      base = musicTracks.filter((track) => track.url).slice(0, 5)
    } else if (profile.music_enabled && profile.music_url) {
      base = [{ id: 'legacy-track', title: profile.music_title || 'Track 1', artist: profile.music_artist || '', url: profile.music_url, type: 'direct' }]
    }
    // If shuffle is enabled, randomize order using Fisher-Yates so each
    // visitor gets a different starting track / play order.
    if (base.length > 1 && (profile as any).music_shuffle === true) {
      const arr = [...base]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      return arr
    }
    return base
  }, [musicTracks, profile.music_artist, profile.music_enabled, profile.music_title, profile.music_url, (profile as any).music_shuffle])

  const currentTrack = playlist[currentTrackIndex] || null
  const musicEnabled = Boolean(profile.music_enabled && currentTrack)

  // Tab title is now owned exclusively by <TabTitleTypewriter /> in
  // app/[username]/page.tsx. The old animated-title effect that lived here
  // (setting document.title to `<username> | scars.meow` and flipping ✦
  // frames) was fighting with the typewriter after the splash dismissed,
  // causing the tab to flash "rez | scars.meow" mid-animation. Removed.

  useEffect(() => {
    if (!contentVisible || !musicEnabled || !audioRef.current || !isPlaying) return
    // Apply the user's saved volume before each play() so first playback
    // always starts at the configured level. HTMLAudioElement defaults to
    // volume=1.0 and the separate volume-sync effect can race the play call.
    audioRef.current.volume = volume
    audioRef.current.play().catch(() => undefined)
  }, [contentVisible, currentTrackIndex, isPlaying, musicEnabled, volume])

  // Auto-play music when enter screen is disabled
  // Uses multiple strategies to bypass browser autoplay restrictions
  const autoplayAttemptedRef = useRef(false)

  useEffect(() => {
    // When enter screen is disabled, attempt autoplay once the audio is ready
    // Never autoplay in previewMode (landing page) - user must click play manually
    if (previewMode || enterEnabled || !contentVisible || !musicEnabled || autoplayAttemptedRef.current) return

    const audio = audioRef.current
    if (!audio) return

    const attemptPlay = async () => {
      if (autoplayAttemptedRef.current) return
      autoplayAttemptedRef.current = true

      // Apply saved volume *before* play() so the user's "Default Volume"
      // setting is respected from the very first frame of audio. Without
      // this the element's default of 1.0 would briefly blast at full
      // volume before the volume-sync effect lowered it.
      audio.volume = volume

      // Strategy 1: Try direct play first
      try {
        await audio.play()
        setIsPlaying(true)
        return
      } catch {
        // Continue to next strategy
      }

      // Strategy 2: Try muted play then unmute
      try {
        audio.muted = true
        await audio.play()
        // Wait a moment then unmute (volume already set above so when we
        // unmute, the user hears their configured level - not 100%).
        setTimeout(() => {
          audio.muted = false
          audio.volume = volume
          setIsPlaying(true)
        }, 100)
        return
      } catch {
        // Browser blocked all autoplay attempts
        audio.muted = false
      }
    }
    
    // Wait for audio to be ready
    if (audio.readyState >= 2) {
      attemptPlay()
    } else {
      audio.addEventListener('canplay', () => attemptPlay(), { once: true })
    }
  }, [enterEnabled, contentVisible, musicEnabled])

  const handleEnter = () => {
    setSplashFading(true)
    window.setTimeout(() => {
      setEntered(true)
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          setContentVisible(true)
          if (musicEnabled) setIsPlaying(true)
        }, 40)
      })
    }, 700)
  }

  const handleGlobalMouseMove = useCallback((event: MouseEvent) => {
    if (!entered || !cardRef.current) return
    if (profile.tilt_effect === false) return
    const rect = cardRef.current.getBoundingClientRect()
    const deltaX = (event.clientX - (rect.left + rect.width / 2)) / 34
    const deltaY = (event.clientY - (rect.top + rect.height / 2)) / 34
    setMousePos({ x: deltaX, y: deltaY })
  }, [entered, previewMode, profile.tilt_effect])

  useEffect(() => {
    const handleLeave = () => setMousePos({ x: 0, y: 0 })
    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseleave', handleLeave)
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseleave', handleLeave)
    }
  }, [handleGlobalMouseMove])

  // Reset tilt when effect is turned off so card snaps back immediately
  useEffect(() => {
    if (profile.tilt_effect === false) setMousePos({ x: 0, y: 0 })
  }, [profile.tilt_effect])

  useEffect(() => {
    if (!currentTrack) return
    setCurrentTime(0)
    setDuration(0)
  }, [currentTrack])

  useEffect(() => {
    if (!audioRef.current) return
    audioRef.current.volume = volume
  }, [volume])

  // Sync volume when profile.music_volume changes (e.g., dashboard preview updates)
  useEffect(() => {
    const v = (profile as any).music_volume
    if (typeof v !== 'number') return
    const next = Math.max(0, Math.min(1, v / 100))
    setVolume(next)
    if (audioRef.current) audioRef.current.volume = next
  }, [(profile as any).music_volume])

  const togglePlay = () => {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => undefined)
      setIsPlaying(true)
    } else {
      audioRef.current.pause()
      setIsPlaying(false)
    }
  }

  const toggleMute = () => {
    if (!audioRef.current) return
    audioRef.current.muted = !audioRef.current.muted
    setIsMuted(audioRef.current.muted)
    setShowVolumePanel(true)
  }

  const updateVolume = (next: number) => {
    const safe = Math.max(0, Math.min(1, next))
    setVolume(safe)
    setIsMuted(safe === 0)
    if (audioRef.current) {
      audioRef.current.volume = safe
      audioRef.current.muted = safe === 0
    }
  }

  const handlePreviousTrack = () => {
    if (playlist.length <= 1) return
    setCurrentTrackIndex((prev) => (prev - 1 + playlist.length) % playlist.length)
    setIsPlaying(true)
  }

  const handleNextTrack = useCallback(() => {
    if (playlist.length <= 1) return
    setCurrentTrackIndex((prev) => (prev + 1) % playlist.length)
    setIsPlaying(true)
  }, [playlist.length])

  const handleTrackEnd = () => {
    if (playlist.length > 1) {
      handleNextTrack()
      return
    }
    setIsPlaying(false)
    setCurrentTime(0)
  }

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    setCurrentTime(audioRef.current.currentTime)
    setDuration(isFinite(audioRef.current.duration) ? audioRef.current.duration : 0)
  }

  const handleSeek = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((event.clientX - rect.left) / rect.width) * duration
  }

  const formatTime = (time: number) => {
    if (!time || Number.isNaN(time)) return '0:00'
    return `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`
  }

  const hoverClass = (() => {
    switch (hoverEffect) {
      case 'glow': return 'hover-glow-card'
      case 'lift': return 'hover-lift-card'
      case 'scale': return 'hover-scale-card'
      case 'pulse': return 'hover-pulse-card'
      case 'shake': return 'hover-shake-card'
      default: return ''
    }
  })()

  const entranceClass = (() => {
    if (!contentVisible) return 'opacity-0 translate-y-8'
    switch (entranceAnimation) {
      case 'none': return 'opacity-100'
      case 'slide': return 'animate-slide-up'
      case 'scale':
      case 'zoom': return 'animate-scale-in'
      case 'bounce': return 'animate-bounce-in'
      default: return 'animate-fade-in'
    }
  })()

  const cardStyles = getCardContainerStyles({
    accentColor,
    backgroundColor: bgColor,
    cardStyle: profile.card_style,
    borderStyle: profile.border_style,
    profileOpacity: profile.profile_opacity,
    profileBlur: profile.profile_blur,
    profileRadius: profile.profile_radius,
    profileBorderColor: profile.profile_border_color,
    profileGradientEnabled: profile.profile_gradient_enabled,
    profileGradientPrimary: profile.profile_gradient_primary,
    profileGradientSecondary: profile.profile_gradient_secondary,
    outlineEnabled: profile.outline_enabled,
    outlineColor: profile.outline_color,
    outlineWidth: profile.outline_width,
    glowColor,
    glowIntensity,
    swapBoxColors,
  })

  // Honor profile_radius if the user explicitly set it; otherwise use responsive default
  const panelRadius = profile.profile_radius != null ? profile.profile_radius : (isMobile ? 28 : 34)
  const musicPanelRadius = isMobile ? 24 : 28
  const backgroundCardStyle: CSSProperties = { ...cardStyles, borderRadius: panelRadius }
  const {
    backgroundColor: cardBackgroundColor,
    backgroundImage: cardBackgroundImage,
    backdropFilter: cardBackdropFilter,
    WebkitBackdropFilter: cardWebkitBackdropFilter,
    backgroundOrigin: cardBackgroundOrigin,
    backgroundClip: cardBackgroundClip,
    ...cardFrameStyle
  } = backgroundCardStyle

  // backdrop-filter MUST live on the shell element itself (not an inner div) so it
  // samples through the actual page background/wallpaper.  Putting it on a child
  // inside an isolation:isolate parent makes it only see the transparent shell.
  const isBlurredEffect = !previewMode && backgroundEffect === 'blurred'
  const panelBlurFilter = isBlurredEffect
    ? 'blur(24px) saturate(1.8)'
    : ((cardBackdropFilter as string | undefined) || undefined)

  const panelShellStyle: CSSProperties = {
    ...cardFrameStyle,
    borderRadius: panelRadius,
    overflow: 'hidden',
    position: 'relative',
    background: 'transparent',
    // Apply backdrop-filter here so it blurs the actual wallpaper behind the card
    backdropFilter: panelBlurFilter,
    WebkitBackdropFilter: panelBlurFilter,
  }
  // Surface div carries only the background color/image - no backdrop-filter
  const panelSurfaceStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    borderRadius: panelRadius,
    backgroundColor: isBlurredEffect
      ? 'rgba(0, 0, 0, 0.4)'
      : ((cardBackgroundColor as string | undefined) || 'transparent'),
    backgroundImage: isBlurredEffect ? undefined : ((cardBackgroundImage as string | undefined) || undefined),
    backgroundOrigin: cardBackgroundOrigin as CSSProperties['backgroundOrigin'],
    backgroundClip: cardBackgroundClip as CSSProperties['backgroundClip'],
  }
  const musicShellStyle: CSSProperties = {
    ...cardFrameStyle,
    borderRadius: musicPanelRadius,
    overflow: 'hidden',
    position: 'relative',
    background: 'transparent',
    backdropFilter: (cardBackdropFilter as string | undefined) || undefined,
    WebkitBackdropFilter: (cardWebkitBackdropFilter as string | undefined) || undefined,
  }
  const musicSurfaceStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    borderRadius: musicPanelRadius,
    backgroundColor: (cardBackgroundColor as string | undefined) || 'transparent',
    backgroundImage: (cardBackgroundImage as string | undefined) || undefined,
    backgroundOrigin: cardBackgroundOrigin as CSSProperties['backgroundOrigin'],
    backgroundClip: cardBackgroundClip as CSSProperties['backgroundClip'],
  }
  const mainAvatarSize = isMobile ? 80 : 96
  const leftAvatarSize = isMobile ? 72 : 88
  const nameTextShadow = profile.glow_username
    ? `0 0 ${Math.max(10, glowIntensity / 3)}px ${hexToRgba(glowColor, 0.8)}, 0 0 ${Math.max(18, glowIntensity / 1.6)}px ${hexToRgba(glowColor, 0.45)}`
    : undefined
  // Display name color: explicit override > swapBoxColors > accentColor
  const nameColor = displayNameColorOverride || (swapBoxColors ? '#ffffff' : accentColor)

  const leftOutsideAvatar = showAvatar && avatarPosition === 'left' && avatarPlacement === 'outside'
  const leftInsideAvatar = showAvatar && avatarPosition === 'left' && avatarPlacement === 'inside'
  const centerOutsideAvatar = showAvatar && avatarPosition === 'center' && avatarPlacement === 'outside'
  const centerInsideAvatar = showAvatar && avatarPosition === 'center' && avatarPlacement === 'inside'
  const hasBio = Boolean((typingBio && bioTexts.length > 0) || profile.bio)
  const equippedBadges = useMemo(() => {
    if (!showBadges) return [] as ProfileBadgeLoadoutItem[]
    const base = [...badgeLoadout].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    // Owner-only crypto loadout for @rez. Hardcoded so they can't be edited
    // off in the dashboard or copied by other users.
    if (userHasCryptoBadges(profile.username)) {
      const hidden = new Set<string>(((profile as any).rez_unequipped_crypto || []) as string[])
      const allowed = getCryptoBadgesForUser(profile.username).filter((c) => !hidden.has(c.slug))
      const lastOrder = base.length ? Math.max(...base.map((b) => b.display_order || 0)) : 0
      const position: LoadoutPosition = base.find((b) => b.position)?.position || 'below_username'
      allowed.forEach((c, i) => {
        base.push({
          badge_id: `rez-crypto-${c.slug}`,
          position,
          display_order: lastOrder + 100 + i,
          badge: {
            id: `rez-crypto-${c.slug}`,
            name: c.name,
            description: c.description,
            icon: c.slug,
            color: c.color,
            glow_color: c.color,
            glow_strength: 12,
            rarity: 'legendary',
          } as Badge,
        })
      })
    }
    return base
  }, [badgeLoadout, showBadges, profile.username, (profile as any).rez_unequipped_crypto])
  const equippedTitles = useMemo(() => {
    if (titleLoadout.length === 0) return [] as ProfileTitleLoadoutItem[]
    return [...titleLoadout].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  }, [titleLoadout])
  const hasContent = hasBio || socialLinks.length > 0 || customButtons.length > 0 || showIdentity || showAvatar || equippedBadges.length > 0 || equippedTitles.length > 0
  const dynamicMinHeight = `${showIdentity === false && showAvatar === false && !hasBio && socialLinks.length === 0 && customButtons.length === 0 ? 96 : leftOutsideAvatar ? (isMobile ? 168 : 200) : centerOutsideAvatar ? (isMobile ? 178 : 214) : hasContent ? (isMobile ? 150 : 190) : 110}px`

  // Avatar geometry - outside layouts now place the avatar's center exactly on
  // the top edge of the card (-translate-y-1/2). The card padding then leaves
  // enough room below the visible half so the name doesn't crash into the
  // avatar.
  const panelPaddingTop = centerOutsideAvatar
    ? (isMobile ? '3.5rem' : '4rem')        // ~ avatarSize/2 + breathing
    : centerInsideAvatar
      ? (isMobile ? '1.35rem' : '1.5rem')
      : leftOutsideAvatar
        ? (isMobile ? '1.6rem' : '2rem')    // name aligns beside avatar's lower half
        : '1.5rem'
  const panelPaddingLeft = leftOutsideAvatar
    ? (isMobile ? '6.5rem' : '7.5rem')      // leftAvatarSize + 24-32px gap
    : '1.5rem'
  const identityAlign = avatarPosition === 'center' ? 'items-center text-center' : 'items-start text-left'
  const socialJustify = avatarPosition === 'center' ? 'justify-center' : 'justify-start'

  const renderTitleRow = (position: string, compact = false) => {
    const items = equippedTitles.filter((item) => item.position === position && item.title)
    if (items.length === 0) return null
    return (
      <div className={`flex flex-wrap gap-2 ${avatarPosition === 'center' ? 'justify-center' : 'justify-start'} ${compact ? '' : ''}`}>
        {items.map((item) => (
          <span
            key={`${position}-${item.title_id}`}
            className={`rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 font-semibold backdrop-blur-md ${compact ? 'text-[11px]' : 'text-xs'}`}
            style={{ color: item.title?.color || '#ffffff', boxShadow: `0 0 16px ${hexToRgba(item.title?.color || accentColor, 0.14)}` }}
          >
            {item.title?.name}
          </span>
        ))}
      </div>
    )
  }

  const renderBadgeRow = (position: string) => {
    const items = equippedBadges.filter((item) => item.position === position && item.badge)
    if (items.length === 0) return null
    // The opacity slider controls the PILL's transparency, not the icons.
    // 100% (default) keeps the original 0.58/0.12 alphas; 0% makes the pill
    // fully see-through while leaving the badge icons fully opaque.
    const pillOpacity = ((profile as any).badge_opacity ?? 100) / 100
    const showPill = pillOpacity > 0
    return (
      <div
        className={`inline-flex flex-wrap items-center gap-1.5 rounded-full px-2 py-1 ${showPill ? 'backdrop-blur-md' : ''} ${avatarPosition === 'center' ? 'justify-center self-center' : 'justify-start'}`}
        style={{
          backgroundColor: hexToRgba('#101015', 0.58 * pillOpacity),
          border: showPill ? `1px solid ${hexToRgba('#ffffff', 0.12 * pillOpacity)}` : 'none',
          boxShadow: profile.glow_badges && showPill ? `0 0 12px ${hexToRgba(glowColor, 0.14 * pillOpacity)}` : undefined,
        }}
      >
        {items.map((item) => {
          const badge = item.badge
          return (
            <BadgeTooltip key={`${position}-${badge.id}`} label={badge.name} glowColor={glowColor}>
              <span
                className="inline-flex h-5 w-5 items-center justify-center overflow-hidden"
                style={(() => {
                  const userBadgeColor = (profile as any).badge_color
                  const monochromeBadges = (profile as any).monochrome_badges === true
                  const badgeRadius = (profile as any).badge_border_radius ?? 50
                  const badgeBorderEnabled = (profile as any).badge_border_enabled === true
                  const badgeBorderColor = (profile as any).badge_border_color || '#ffffff'
                  const badgeBorderWidth = (profile as any).badge_border_width ?? 1
                  const badgeBorderOpacity = ((profile as any).badge_border_opacity ?? 100) / 100
                  const badgeGlowMult = ((profile as any).badge_glow_strength ?? 50) / 50
                  const finalColor = monochromeBadges ? userBadgeColor || '#ffffff' : (badge.color || '#ffffff')
                  const glowSize = (badge.glow_strength || 10) * badgeGlowMult
                  return {
                    color: finalColor,
                    borderRadius: `${badgeRadius}%`,
                    border: badgeBorderEnabled ? `${badgeBorderWidth}px solid ${hexToRgba(badgeBorderColor, badgeBorderOpacity)}` : undefined,
                    filter: badge.glow_color && profile.glow_badges ? `drop-shadow(0 0 ${glowSize * 0.5}px ${badge.glow_color}) drop-shadow(0 0 ${glowSize}px ${hexToRgba(badge.glow_color, 0.6)})` : undefined,
                    textShadow: badge.glow_color && profile.glow_badges ? `0 0 ${glowSize * 0.6}px ${badge.glow_color}` : undefined,
                  } as React.CSSProperties
                })()}
              >
                {badge.icon_url ? <img loading="lazy" decoding="async" src={badge.icon_url} alt="" className="h-full w-full object-contain" /> : <BadgeIcon name={badge.icon || badge.name} className="h-4 w-4" />}
              </span>
            </BadgeTooltip>
          )
        })}
      </div>
    )
  }

  const renderPositionCluster = (position: string) => {
    const titleRow = renderTitleRow(position, true)
    const badgeRow = renderBadgeRow(position)
    if (!titleRow && !badgeRow) return null
    return (
      <div className={`flex flex-col gap-2 ${avatarPosition === 'center' ? 'items-center' : 'items-start'}`}>
        {titleRow}
        {badgeRow}
      </div>
    )
  }

  const badgesNextToName = (profile as any).badges_next_to_name === true
  const identityBlock = showIdentity ? (
    <div className={`relative overflow-visible ${identityAlign}`}>
      {/* Badges/titles above username (only when not inline-with-name) */}
      {!badgesNextToName && renderPositionCluster('above_username') ? <div className="relative z-40 mb-3">{renderPositionCluster('above_username')}</div> : null}
      {/* Single name line - promoted from the old small @handle. The big
          "display name" line that used to sit above this was removed (users
          asked for one name only, not display_name + @handle stacked).
          The Username Overlay value (`displayName` here - falls back to the
          raw username) shows after the @. URL/route never changes. */}
      {/* Name + inline-badges row. Grid layout so the username position is
          stable regardless of how many badges are attached:
            - center avatar: 3-col grid [spacer | name | badges] keeps the
              name dead-center and pushes badges into the right column
            - left avatar:   2-col grid [name | badges] anchors the name
              left, badges flow into the right column
          Without grid, flex+wrap+justify-center caused the username to
          shift left as badges were added on the same row. */}
      <div
        className={`grid items-center gap-3 overflow-visible ${
          badgesNextToName
            ? avatarPosition === 'center'
              ? 'grid-cols-[1fr_auto_1fr]'
              : 'grid-cols-[auto_1fr]'
            : avatarPosition === 'center'
              ? 'grid-cols-1 justify-items-center text-center'
              : 'grid-cols-1 justify-items-start text-left'
        }`}
        style={{ position: 'relative', zIndex: 60 }}
      >
        {/* Left spacer - only rendered for centered avatars with inline
            badges, so the 3-col grid balances visually and the name stays
            in the exact middle. */}
        {badgesNextToName && avatarPosition === 'center' ? <span aria-hidden /> : null}
        <button
          ref={uidTriggerRef}
          type="button"
          className="group relative inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-default"
          onMouseEnter={showUidTooltip}
          onMouseLeave={() => setShowUid(false)}
        >
          <UsernameDisplay
            text={displayName}
            effect={usernameEffect}
            accentColor={accentColor}
            className={isMobile ? 'text-[1.5rem] font-bold leading-none' : 'text-[1.75rem] font-bold leading-none'}
            style={{ color: nameColor, textShadow: nameTextShadow, fontFamily: fontApplyUsername }}
          />
        </button>
        {/* UID tooltip - portaled to document.body so it sits above every
            stacking context (avatar, decoration overlay, badges). Position
            comes from the trigger's getBoundingClientRect, captured on
            hover. Mirrors the BadgeTooltip portal pattern above. */}
        {showUid && uidCoords && typeof document !== 'undefined'
          ? createPortal(
              <span
                className="pointer-events-none fixed z-[2147483646] whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase"
                style={{
                  left: uidCoords.x,
                  top: uidCoords.y - 10,
                  transform: 'translate(-50%, -100%)',
                  backgroundColor: hexToRgba('#0b0b12', 0.92),
                  color: hexToRgba('#ffffff', 0.7),
                  border: `1px solid ${hexToRgba('#ffffff', 0.12)}`,
                  boxShadow: `0 0 16px ${hexToRgba(glowColor, 0.15)}`,
                }}
              >
                {uidText}
              </span>,
              document.body,
            )
          : null}
        {badgesNextToName ? (
          // flex-nowrap keeps the inline-with-name badges on a single
          // row. min-w-0 lets the column actually shrink past its
          // content's intrinsic size so a long loadout doesn't push the
          // name out of position; overflow-x-hidden clips anything that
          // doesn't fit instead of wrapping to a second row.
          <span className="relative z-40 inline-flex flex-nowrap items-center gap-1.5 justify-self-start min-w-0 overflow-x-hidden overflow-y-visible">
            {renderPositionCluster('above_username') || renderPositionCluster('below_username')}
          </span>
        ) : null}
      </div>
      {!badgesNextToName && renderPositionCluster('below_username') ? <div className="relative z-40 mt-3">{renderPositionCluster('below_username')}</div> : null}
    </div>
  ) : null

  if (enterEnabled && !entered) {
    return (
      <div
        className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center"
        onClick={handleEnter}
        style={{
          backgroundColor: '#000000',
          fontFamily,
          opacity: splashFading ? 0 : 1,
          transform: splashFading ? 'scale(1.04)' : 'scale(1)',
          filter: splashFading ? 'blur(8px)' : 'blur(0)',
          transition: 'opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 700ms cubic-bezier(0.22, 1, 0.36, 1), filter 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <CustomFontFace url={profile.custom_font_url} slots={fontSlots} />
        {profile.background_url && (
          isVideoUrl(profile.background_url)
            ? <BackgroundVideo src={profile.background_url} className={`absolute inset-0 h-full w-full object-cover opacity-35 ${backgroundEffect === 'blurred' ? 'blur-xl scale-110' : ''}`} />
            : <div className={`absolute inset-0 bg-cover bg-center opacity-35 ${backgroundEffect === 'blurred' ? 'blur-xl scale-110' : ''}`} style={{ backgroundImage: `url(${profile.background_url})` }} />
        )}
        <BackgroundEffectsOverlay effect={backgroundEffect} accentColor={accentColor} glowColor={glowColor} strength={profile.background_effect_strength ?? 50} />
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative z-10 px-6 text-center">
          {showEnterProfile && profile.avatar_url && (
            <div className="mx-auto mb-6 h-28 w-28 overflow-hidden rounded-full" style={{ ...avatarShapeStyle }}>
              <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
          )}
          {showEnterTitle && (
            <UsernameDisplay text={enterTitle} effect={usernameEffect} accentColor={accentColor} className="text-3xl font-bold text-white" style={{ textShadow: nameTextShadow }} />
          )}
          {showEnterSubtitle ? <p className="mt-3 text-sm text-white/45 animate-pulse">{enterSubtitle}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div
      className={previewMode ? undefined : `fixed inset-0 overflow-hidden ${useCustomCursorOverlay ? 'custom-cursor-active' : ''}`}
      style={previewMode
        ? { fontFamily, position: 'relative', width: '100%' }
        : { backgroundColor: '#09090f', fontFamily }}
    >
      <CustomFontFace url={profile.custom_font_url} slots={fontSlots} />

      {musicEnabled && currentTrack && (
        <audio
          key={currentTrack.id}
          ref={audioRef}
          src={currentTrack.url}
          muted={isMuted}
          onLoadedMetadata={handleTimeUpdate}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={handleTrackEnd}
          loop={playlist.length === 1}
        />
      )}

      {!previewMode && profile.background_url && (
        isVideoUrl(profile.background_url)
          ? <BackgroundVideo src={profile.background_url} className={`absolute inset-0 h-full w-full object-cover ${backgroundEffect === 'blurred' ? 'blur-xl scale-110' : ''}`} />
          : <div className={`absolute inset-0 bg-cover bg-center ${backgroundEffect === 'blurred' ? 'blur-xl scale-110' : ''}`} style={{ backgroundImage: `url(${profile.background_url})` }} />
      )}
      {!previewMode && <BackgroundEffectsOverlay effect={backgroundEffect} accentColor={accentColor} glowColor={glowColor} strength={profile.background_effect_strength ?? 50} />}
      {!previewMode && <div className="absolute inset-0 bg-black/28" />}

      {!previewMode && (
        (cursorEffect && cursorEffect !== 'none') ||
        customCursorUrl ||
        hoverCursorUrl ||
        (cursorClickEffect && cursorClickEffect !== 'none')
      ) ? (
        <CursorEffectsLayer
          cursorEffect={cursorEffect}
          cursorColor={cursorColor}
          clickEffect={cursorClickEffect}
          clickColor={cursorClickColor}
          customCursorUrl={customCursorUrl}
          hoverCursorUrl={hoverCursorUrl}
        />
      ) : null}

      {musicEnabled && volumeControl && !previewMode && (
        <div className={`fixed z-50 ${isMobile ? 'left-3 top-3' : 'left-6 top-6'}`} onMouseEnter={() => setShowVolumePanel(true)} onMouseLeave={() => setShowVolumePanel(false)}>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
            aria-pressed={isMuted}
            title={isMuted ? 'Unmute' : 'Mute'}
            className={`flex items-center justify-center rounded-xl border border-white/10 bg-black/50 text-white/70 backdrop-blur-sm transition hover:text-white ${isMobile ? 'h-10 w-10' : 'h-12 w-12'}`}
          >
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          {showVolumePanel && (
            <div className="mt-2 w-28 rounded-2xl border border-white/10 bg-black/55 p-3 backdrop-blur-md">
              <input type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => updateVolume(Number(e.target.value) / 100)} className="w-full accent-white" aria-label="Volume" />
            </div>
          )}
        </div>
      )}

      <div className={previewMode ? 'relative w-full' : 'absolute inset-0 overflow-y-auto'}>
        <div
          className={`relative z-20 flex ${previewMode ? '' : `min-h-full px-4 py-10`} ${layoutMode === 'portfolio' ? 'justify-start' : 'justify-center'}`}
          style={{
            alignItems: layoutMode === 'portfolio' ? 'flex-start' : 'center',
            paddingTop: previewMode ? 0 : (isMobile ? '1.5rem' : layoutMode === 'portfolio' ? '3rem' : '2rem'),
            paddingBottom: previewMode ? 0 : (isMobile ? '2rem' : '2.5rem'),
          }}
        >
          <div
            ref={cardRef}
            className={`w-full ${layoutMode === 'modern' ? 'layout-modern' : layoutMode === 'portfolio' ? 'layout-portfolio' : 'layout-default'}`}
            style={{
              maxWidth: previewMode
                ? '100%'
                : isMobile
                  ? '100%'
                  : layoutMode === 'modern'
                    ? '780px'
                    : layoutMode === 'portfolio'
                      ? '560px'
                      : getPanelMaxWidth(panelSize),
              marginTop: centerOutsideAvatar ? (isMobile ? '1rem' : '1.5rem') : leftOutsideAvatar ? (isMobile ? '0.6rem' : '1rem') : '0',
              // NOTE: transformStyle:'preserve-3d' is intentionally omitted - it creates a 3D
              // rendering context that prevents backdrop-filter from working on child elements.
              // The tilt effect is a flat 2D rotation and does not need preserve-3d.
              transform: contentVisible && profile.tilt_effect !== false && (mousePos.x !== 0 || mousePos.y !== 0)
                ? `perspective(1200px) rotateY(${mousePos.x}deg) rotateX(${-mousePos.y}deg)`
                : undefined,
              transition: 'transform 120ms ease-out',
            }}
          >
            <div className={`relative z-20 ${entranceClass}`}>
              <div className={`relative overflow-visible ${hoverClass}`} style={{ '--hover-effect-color': hoverEffectColor, borderRadius: panelRadius } as React.CSSProperties}>
                {centerOutsideAvatar && layoutMode === 'default' && (
                  <div
                    className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1/2"
                    style={{ width: mainAvatarSize, height: mainAvatarSize }}
                  >
                    <AvatarWithDecoration
                      size={mainAvatarSize}
                      decorationSlug={(profile as any).avatar_decoration_hash}
                      avatarShapeStyle={avatarShapeStyle}
                    >
                      {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                    </AvatarWithDecoration>
                  </div>
                )}

                {leftOutsideAvatar && layoutMode === 'default' && (
                  <div
                    className={`pointer-events-none absolute z-30 ${isMobile ? 'left-4 top-0 -translate-y-1/2' : 'left-6 top-0 -translate-y-1/2'}`}
                    style={{ width: leftAvatarSize, height: leftAvatarSize }}
                  >
                    <AvatarWithDecoration
                      size={leftAvatarSize}
                      decorationSlug={(profile as any).avatar_decoration_hash}
                      avatarShapeStyle={avatarShapeStyle}
                    >
                      {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                    </AvatarWithDecoration>
                  </div>
                )}

                {/* View count badge - TOP positions only: floats at card corner at z-31 (above avatar at z-30) */}
                {layoutMode === 'default' && (viewsLocationPosition === 'top-left' || viewsLocationPosition === 'top-right') && (profile.show_view_count !== false || profile.location || (profile as any).show_join_date) && (
                  <div
                    className={`pointer-events-none absolute z-[31] flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-full px-2.5 py-1 ${isMobile ? 'text-xs' : 'text-sm'}`}
                    style={{
                      color: viewsBadgeBackground ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.7)',
                      background: viewsBadgeBackground ? 'rgba(0,0,0,0.38)' : 'transparent',
                      backdropFilter: viewsBadgeBackground ? 'blur(10px)' : undefined,
                      WebkitBackdropFilter: viewsBadgeBackground ? 'blur(10px)' : undefined,
                      maxWidth: 'calc(50% - 36px)',
                      ...getViewsPositionStyle(viewsLocationPosition, isMobile),
                    }}
                  >
                    {profile.show_view_count !== false && (
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        <AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} />
                      </span>
                    )}
                    {profile.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {profile.location}
                      </span>
                    )}
                  </div>
                )}

                <div className="relative" style={{ ...panelShellStyle, minHeight: dynamicMinHeight }}>
                  <div aria-hidden className="absolute inset-0" style={panelSurfaceStyle} />

                  {/* ── MODERN layout: full-width banner header + content below ── */}
                  {layoutMode === 'modern' && (
                    <div className="relative z-10">
                      {/* Banner */}
                      <div className="relative h-28 w-full overflow-hidden" style={{ borderRadius: `${panelRadius}px ${panelRadius}px 0 0` }}>
                        {profile.avatar_url ? (
                          <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" style={{ filter: 'blur(18px) brightness(0.55) saturate(1.4)', transform: 'scale(1.15)' }} />
                        ) : (
                          <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${hexToRgba(accentColor, 0.6)}, ${hexToRgba(glowColor, 0.3)})` }} />
                        )}
                        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 30%, ${hexToRgba('#000000', 0.7)})` }} />
                        {/* Avatar over banner */}
                        {showAvatar && (
                          <div className="absolute bottom-0 left-5 translate-y-1/2">
                            <div className="overflow-hidden rounded-full" style={{ width: 72, height: 72, ...avatarShapeStyle }}>
                              {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} /> : <div className="flex h-full w-full items-center justify-center text-xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                            </div>
                          </div>
                        )}
                        {/* View count + location - position controlled by setting */}
                        <div className="absolute flex items-center gap-2 text-xs" style={{ color: hexToRgba('#ffffff', 0.7), ...getViewsPositionStyle(viewsLocationPosition, true) }}>
                          {profile.show_view_count !== false && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /><AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} /></span>}
                          {profile.location && <span className="flex items-center gap-1" style={{ color: locationColor }}><MapPin className="h-3.5 w-3.5" />{profile.location}</span>}
                        </div>
                      </div>
                      {/* Content below banner */}
                      <div className="px-5 pb-5 pt-11 text-left">
                        {identityBlock}
                        {hasBio && (
                          <div className="mt-2 mb-4 text-sm" style={{ color: hexToRgba(bioColor, 0.84) }}>
                            {typingBio && bioTexts.length > 0 ? <TypingBio texts={bioTexts} speed={typingSpeed} color={hexToRgba(bioColor, 0.84)} /> : profile.bio ? <div style={{ fontFamily: fontApplyBio }} dangerouslySetInnerHTML={{ __html: renderBioMarkdown(profile.bio) }} /> : null}
                          </div>
                        )}
                        {renderPositionCluster('above_links') ? <div className="mb-3">{renderPositionCluster('above_links')}</div> : null}
                        {socialLinks.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2.5 mt-3">
                            {socialLinks.map((link) => {
                              const wrapperStyle = getSocialIconWrapperStyle({ accentColor, textColor, glowSocials: profile.glow_socials, glowColor, glowIntensity, swapBoxColors, noBackground: (profile as any).social_icons_no_background })
                              const resolvedColor = monochromeIcons ? iconColor : (brandColors[link.platform.toLowerCase()] || iconColor)
                              const href = buildSocialHref(link.platform, link.url)
                              return (
                                <a key={link.id} href={href} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_id:profile.id, link_type:'social', link_id:link.id}), keepalive:true }).catch(()=>{})} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg transition-all hover:scale-110" style={wrapperStyle} aria-label={link.label || link.platform} title={link.label || link.platform}>
                                  {link.platform === 'custom' && link.icon_url ? <img loading="lazy" decoding="async" src={link.icon_url} alt={link.label||''} className="max-h-full max-w-full rounded-md object-contain p-1.5" /> : <SocialIcon platform={link.platform} className={socialIconClass} style={{ color: resolvedColor }} />}
                                </a>
                              )
                            })}
                          </div>
                        )}
                        {customButtons.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {customButtons.map((button) => {
                              const buttonHref = safeButtonHref(button.url)
                              return (
                                <a key={button.id} href={buttonHref} aria-label={button.label} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_id:profile.id, link_type:'button', link_id:button.id}), keepalive:true }).catch(()=>{})} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:scale-[1.02]" style={getButtonStyle(button, { accentColor, textColor, outlineEnabled: profile.outline_enabled, outlineColor: profile.outline_color, glowColor, glowIntensity, swapBoxColors })}>
                                  {button.media_url ? <img loading="lazy" decoding="async" src={button.media_url} alt="" className="h-6 w-6 rounded object-cover" /> : null}
                                  <span>{button.label}</span>
                                  <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                                </a>
                              )
                            })}
                          </div>
                        )}
                        {renderPositionCluster('below_links') ? <div className="mt-3">{renderPositionCluster('below_links')}</div> : null}
                        <WidgetsPanel userId={profile.id} displayMode={profile.widget_display_mode ?? 'carousel'} />
                      </div>
                    </div>
                  )}

                  {/* ── PORTFOLIO layout: left avatar sidebar + right content ── */}
                  {layoutMode === 'portfolio' && (
                    <div className="relative z-10 flex min-h-full">
                      {/* Left sidebar */}
                      <div className="flex w-32 shrink-0 flex-col items-center gap-3 px-3 py-5" style={{ borderRight: `1px solid ${hexToRgba('#ffffff', 0.07)}`, background: hexToRgba(accentColor, 0.04) }}>
                        {showAvatar && (
                          <div className="overflow-hidden rounded-2xl" style={{ width: 72, height: 72, ...avatarShapeStyle }}>
                            {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                          </div>
                        )}
                        {profile.show_view_count !== false && (
                          <div className="flex flex-col items-center gap-0.5 text-center">
                            <span className="text-base font-bold text-white"><AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} /></span>
                            <span className="text-[10px] uppercase tracking-wide" style={{ color: hexToRgba(textColor, 0.4) }}>Views</span>
                          </div>
                        )}
                        {profile.location && (
                          <div className="flex items-center gap-1 text-center text-[11px]" style={{ color: hexToRgba(textColor, 0.5) }}>
                            <MapPin className="h-3 w-3 shrink-0" /><span className="break-words">{profile.location}</span>
                          </div>
                        )}
                        {renderPositionCluster('above_links') && <div className="w-full">{renderPositionCluster('above_links')}</div>}
                        {socialLinks.length > 0 && (
                          <div className="flex flex-wrap justify-center gap-2 mt-1">
                            {socialLinks.map((link) => {
                              const wrapperStyle = getSocialIconWrapperStyle({ accentColor, textColor, glowSocials: profile.glow_socials, glowColor, glowIntensity, swapBoxColors, noBackground: (profile as any).social_icons_no_background })
                              const resolvedColor = monochromeIcons ? iconColor : (brandColors[link.platform.toLowerCase()] || iconColor)
                              const href = buildSocialHref(link.platform, link.url)
                              return (
                                <a key={link.id} href={href} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_id:profile.id, link_type:'social', link_id:link.id}), keepalive:true }).catch(()=>{})} className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg transition-all hover:scale-110" style={wrapperStyle} aria-label={link.label || link.platform} title={link.label || link.platform}>
                                  {link.platform === 'custom' && link.icon_url ? <img loading="lazy" decoding="async" src={link.icon_url} alt={link.label||''} className="max-h-full max-w-full rounded-md object-contain p-1" /> : <SocialIcon platform={link.platform} className={socialIconClassSmall} style={{ color: resolvedColor }} />}
                                </a>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      {/* Right content */}
                      <div className="flex-1 overflow-hidden px-4 py-5 text-left">
                        {identityBlock}
                        {hasBio && (
                          <div className="mt-2 mb-4 text-sm" style={{ color: hexToRgba(bioColor, 0.84) }}>
                            {typingBio && bioTexts.length > 0 ? <TypingBio texts={bioTexts} speed={typingSpeed} color={hexToRgba(bioColor, 0.84)} /> : profile.bio ? <div style={{ fontFamily: fontApplyBio }} dangerouslySetInnerHTML={{ __html: renderBioMarkdown(profile.bio) }} /> : null}
                          </div>
                        )}
                        {customButtons.length > 0 && (
                          <div className="space-y-2 mb-4">
                            {customButtons.map((button) => {
                              const buttonHref = safeButtonHref(button.url)
                              return (
                                <a key={button.id} href={buttonHref} aria-label={button.label} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({user_id:profile.id, link_type:'button', link_id:button.id}), keepalive:true }).catch(()=>{})} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:scale-[1.02]" style={getButtonStyle(button, { accentColor, textColor, outlineEnabled: profile.outline_enabled, outlineColor: profile.outline_color, glowColor, glowIntensity, swapBoxColors })}>
                                  {button.media_url ? <img loading="lazy" decoding="async" src={button.media_url} alt="" className="h-6 w-6 rounded object-cover" /> : null}
                                  <span>{button.label}</span>
                                  <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                                </a>
                              )
                            })}
                          </div>
                        )}
                        {renderPositionCluster('below_links') ? <div className="mt-2">{renderPositionCluster('below_links')}</div> : null}
                        <WidgetsPanel userId={profile.id} displayMode={profile.widget_display_mode ?? 'carousel'} />
                      </div>
                    </div>
                  )}

                  {/* ── DEFAULT layout (existing rendering) ── */}
                  {layoutMode === 'default' && <>

                  <div className={`relative z-10 p-6 ${avatarPosition === 'center' ? 'text-center' : 'text-left'}`} style={{ paddingTop: panelPaddingTop, paddingLeft: panelPaddingLeft, paddingRight: '1.5rem' }}>
                    {/* Left + Inside - avatar and identity side-by-side (Discord-style header) */}
                    {leftInsideAvatar ? (
                      <div className="mb-4 flex items-center gap-4">
                        <div
                          className="relative shrink-0 overflow-hidden rounded-full"
                          style={{
                            width: leftAvatarSize,
                            height: leftAvatarSize,
                            ...avatarShapeStyle,
                          }}
                        >
                          {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          {identityBlock}
                        </div>
                      </div>
                    ) : (
                      <>
                        {centerInsideAvatar && (
                          <div className="mb-4 flex justify-center">
                            <div
                              className="relative overflow-hidden rounded-full"
                              style={{
                                width: mainAvatarSize,
                                height: mainAvatarSize,
                                ...avatarShapeStyle,
                              }}
                            >
                              {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName[0]?.toUpperCase()}</div>}
                            </div>
                          </div>
                        )}

                        {identityBlock}
                      </>
                    )}

                    {hasBio && (
                      <div className={`mt-3 mb-6 min-h-[1.5em] text-sm ${avatarPosition === 'center' ? 'text-center' : 'text-left'}`} style={{ color: hexToRgba(bioColor, 0.84) }}>
                        {typingBio && bioTexts.length > 0 ? <TypingBio texts={bioTexts} speed={typingSpeed} color={hexToRgba(bioColor, 0.84)} /> : profile.bio ? <div style={{ fontFamily: fontApplyBio }} dangerouslySetInnerHTML={{ __html: renderBioMarkdown(profile.bio) }} /> : null}
                      </div>
                    )}

                    {renderPositionCluster('above_links') ? <div className="mb-4">{renderPositionCluster('above_links')}</div> : null}

                    {socialLinks.length > 0 && (
                      <div className={`flex flex-wrap items-center gap-3 mt-4 ${socialJustify}`}>
                        {socialLinks.map((link) => {
                          const wrapperStyle = getSocialIconWrapperStyle({
                            accentColor,
                            textColor,
                            glowSocials: profile.glow_socials,
                            glowColor,
                            glowIntensity,
                            swapBoxColors,
                            noBackground: (profile as any).social_icons_no_background,
                          })
                          const resolvedColor = monochromeIcons ? iconColor : (brandColors[link.platform.toLowerCase()] || iconColor)
                          const cryptoIds = ['btc','eth','ltc','sol','xmr']
                          const isCrypto = cryptoIds.includes(link.platform.toLowerCase())
                          const href = buildSocialHref(link.platform, link.url)

                          const iconNode = link.platform === 'custom' && link.icon_url ? (
                            <div className="flex h-full w-full items-center justify-center p-2">
                              <img loading="lazy" decoding="async" src={link.icon_url} alt={link.label || 'Custom link'} className="max-h-full max-w-full rounded-md object-contain" />
                            </div>
                          ) : (
                            <SocialIcon platform={link.platform} className={`${isMobile ? (noBgIcons ? 'h-[22px] w-[22px]' : 'h-[18px] w-[18px]') : socialIconClass}`} style={{ color: resolvedColor }} />
                          )

                          if (isCrypto) {
                            return (
                              <button
                                key={link.id}
                                type="button"
                                onClick={async (e) => {
                                  e.preventDefault()
                                  try {
                                    await navigator.clipboard.writeText(link.url)
                                    const el = e.currentTarget as HTMLButtonElement
                                    const prev = el.getAttribute('data-label')
                                    el.setAttribute('title', 'Copied!')
                                    setTimeout(() => el.setAttribute('title', prev || link.platform), 1200)
                                  } catch {}
                                }}
                                data-label={link.platform.toUpperCase()}
                                className={`flex items-center justify-center overflow-hidden rounded-lg transition-all hover:scale-110 ${isMobile ? 'h-11 w-11' : 'h-11 w-11'}`}
                                style={wrapperStyle}
                                title={`Click to copy ${link.platform.toUpperCase()} address`}
                              >
                                {iconNode}
                              </button>
                            )
                          }

                          return (
                            <a
                              key={link.id}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => {
                                // Fire-and-forget click tracking
                                fetch('/api/track-click', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ user_id: profile.id, link_type: 'social', link_id: link.id }),
                                  keepalive: true,
                                }).catch(() => {})
                              }}
                              className={`flex items-center justify-center overflow-hidden rounded-lg transition-all hover:scale-110 ${isMobile ? 'h-11 w-11' : 'h-11 w-11'}`}
                              style={wrapperStyle}
                              aria-label={link.label || link.platform} title={link.label || link.platform}
                            >
                              {iconNode}
                            </a>
                          )
                        })}
                      </div>
                    )}

                    {customButtons.length > 0 && (
                      <div className="mt-4 space-y-2.5">
                        {customButtons.map((button) => {
                          const buttonHref = safeButtonHref(button.url)
                          return (
                          <a
                            key={button.id}
                            href={buttonHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              fetch('/api/track-click', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ user_id: profile.id, link_type: 'button', link_id: button.id }),
                                keepalive: true,
                              }).catch(() => {})
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-sm font-semibold transition hover:scale-[1.02]"
                            style={getButtonStyle(button, {
                              accentColor,
                              textColor,
                              outlineEnabled: profile.outline_enabled,
                              outlineColor: profile.outline_color,
                              glowColor,
                              glowIntensity,
                              swapBoxColors,
                            })}
                          >
                            {button.media_url ? <img loading="lazy" decoding="async" src={button.media_url} alt="" className="h-7 w-7 rounded object-cover" /> : null}
                            <span>{button.label}</span>
                            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                          </a>
                        )})}
                      </div>
                    )}

                    {renderPositionCluster('below_links') ? <div className="mt-4">{renderPositionCluster('below_links')}</div> : null}
                    <WidgetsPanel userId={profile.id} displayMode={profile.widget_display_mode ?? 'carousel'} />

                    {/* BOTTOM view count - flows after all card content, styled as pill to match TOP */}
                    {(viewsLocationPosition === 'bottom-left' || viewsLocationPosition === 'bottom-right') && (profile.show_view_count !== false || profile.location) && (
                      <div className={`mt-4 flex ${viewsLocationPosition === 'bottom-right' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 ${isMobile ? 'text-xs' : 'text-sm'}`} style={{ color: viewsBadgeBackground ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.7)', background: viewsBadgeBackground ? 'rgba(0,0,0,0.38)' : 'transparent', backdropFilter: viewsBadgeBackground ? 'blur(10px)' : undefined, WebkitBackdropFilter: viewsBadgeBackground ? 'blur(10px)' : undefined }}>
                          {profile.show_view_count !== false && (
                            <span className="flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              <AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} />
                            </span>
                          )}
                          {profile.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {profile.location}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  </>}

                  {/* ── MINIMAL layout: floating content, no panel chrome ── */}
                  {(layoutMode === 'minimal' || layoutMode === 'banner') && (
                    <div className="relative z-10">
                      {/* Banner strip (banner layout only) */}
                      {layoutMode === 'banner' && (
                        <div className="relative h-36 w-full overflow-hidden" style={{ borderRadius: `${panelRadius}px ${panelRadius}px 0 0` }}>
                          {profile.banner_url ? (
                            <img decoding="async" src={profile.banner_url} alt="" className="h-full w-full object-cover" />
                          ) : profile.background_url ? (
                            <img decoding="async" src={profile.background_url} alt="" className="h-full w-full object-cover" style={{ filter: 'blur(6px) brightness(0.6) saturate(1.3)', transform: 'scale(1.05)' }} />
                          ) : (
                            <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${hexToRgba(accentColor, 0.5)}, ${hexToRgba(glowColor, 0.25)})` }} />
                          )}
                          <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, transparent 40%, ${hexToRgba('#000000', 0.65)})` }} />
                          {/* Stats overlay - position controlled by setting */}
                          <div className="absolute flex items-center gap-2 text-xs" style={{ color: hexToRgba('#ffffff', 0.7), ...getViewsPositionStyle(viewsLocationPosition, true) }}>
                            {profile.show_view_count !== false && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /><AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} /></span>}
                            {profile.location && <span className="flex items-center gap-1" style={{ color: locationColor }}><MapPin className="h-3.5 w-3.5" />{profile.location}</span>}
                          </div>
                        </div>
                      )}

                      <div className={`px-5 pb-6 ${layoutMode === 'banner' ? 'pt-5' : 'pt-6'} ${avatarPosition === 'center' ? 'text-center' : 'text-left'}`}>
                        {/* Stats row for minimal layout */}
                        {layoutMode === 'minimal' && (
                          <div className={`mb-3 flex items-center gap-2 text-xs ${avatarPosition === 'center' ? 'justify-center' : ''}`} style={{ color: hexToRgba(textColor, 0.5) }}>
                            {profile.show_view_count !== false && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /><AnimatedViewCount target={profile.view_count || 0} animate={animateViewCount} /></span>}
                            {profile.location && <span className="flex items-center gap-1" style={{ color: locationColor }}><MapPin className="h-3.5 w-3.5" />{profile.location}</span>}
                          </div>
                        )}

                        {showAvatar && (
                          <div className={`mb-4 flex ${avatarPosition === 'center' ? 'justify-center' : 'justify-start'}`}>
                            <div
                              className="overflow-hidden rounded-full"
                              style={{ width: mainAvatarSize, height: mainAvatarSize, ...avatarShapeStyle }}
                            >
                              {profile.avatar_url ? <img decoding="async" src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: hexToRgba(accentColor, 0.2), color: accentColor }}>{displayName?.[0]?.toUpperCase()}</div>}
                            </div>
                          </div>
                        )}

                        {identityBlock}

                        {hasBio && (
                          <div className={`mt-3 mb-5 min-h-[1.5em] text-sm ${avatarPosition === 'center' ? 'text-center' : 'text-left'}`} style={{ color: hexToRgba(bioColor, 0.84) }}>
                            {typingBio && bioTexts.length > 0 ? <TypingBio texts={bioTexts} speed={typingSpeed} color={hexToRgba(bioColor, 0.84)} /> : profile.bio ? <div style={{ fontFamily: fontApplyBio }} dangerouslySetInnerHTML={{ __html: renderBioMarkdown(profile.bio) }} /> : null}
                          </div>
                        )}

                        {renderPositionCluster('above_links') ? <div className="mb-4">{renderPositionCluster('above_links')}</div> : null}

                        {socialLinks.length > 0 && (
                          <div className={`flex flex-wrap gap-2.5 mb-4 ${avatarPosition === 'center' ? 'justify-center' : ''}`}>
                            {socialLinks.map((link) => {
                              const wrapperStyle = getSocialIconWrapperStyle({ accentColor, textColor, glowSocials: profile.glow_socials, glowColor, glowIntensity, swapBoxColors, noBackground: (profile as any).social_icons_no_background })
                              const resolvedColor = monochromeIcons ? iconColor : (brandColors[link.platform.toLowerCase()] || iconColor)
                              const href = buildSocialHref(link.platform, link.url)
                              return (
                                <a key={link.id} href={href} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: profile.id, link_type: 'social', link_id: link.id }), keepalive: true }).catch(() => {})} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg transition-all hover:scale-110" style={wrapperStyle} aria-label={link.label || link.platform} title={link.label || link.platform}>
                                  {link.platform === 'custom' && link.icon_url ? <img loading="lazy" decoding="async" src={link.icon_url} alt={link.label || ''} className="max-h-full max-w-full rounded-md object-contain p-1.5" /> : <SocialIcon platform={link.platform} className={socialIconClass} style={{ color: resolvedColor }} />}
                                </a>
                              )
                            })}
                          </div>
                        )}

                        {customButtons.length > 0 && (
                          <div className="space-y-2 mb-4">
                            {customButtons.map((button) => {
                              const buttonHref = safeButtonHref(button.url)
                              return (
                                <a key={button.id} href={buttonHref} aria-label={button.label} target="_blank" rel="noopener noreferrer" onClick={() => fetch('/api/track-click', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: profile.id, link_type: 'button', link_id: button.id }), keepalive: true }).catch(() => {})} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-center text-sm font-semibold transition hover:scale-[1.02]" style={getButtonStyle(button, { accentColor, textColor, outlineEnabled: profile.outline_enabled, outlineColor: profile.outline_color, glowColor, glowIntensity, swapBoxColors })}>
                                  {button.media_url ? <img loading="lazy" decoding="async" src={button.media_url} alt="" className="h-7 w-7 rounded object-cover" /> : null}
                                  <span>{button.label}</span>
                                  <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                                </a>
                              )
                            })}
                          </div>
                        )}

                        {renderPositionCluster('below_links') ? <div className="mt-4">{renderPositionCluster('below_links')}</div> : null}
                        <WidgetsPanel userId={profile.id} displayMode={profile.widget_display_mode ?? 'carousel'} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {musicEnabled && currentTrack && !(p as any).music_hide_panel && (
              <div className={`relative z-20 transition-all duration-500 ${isMobile ? 'mt-5' : 'mt-8'}`} style={{ opacity: contentVisible ? 1 : 0, transform: contentVisible ? 'translateY(0)' : 'translateY(10px)' }}>
                <div className="relative" style={{ ...musicShellStyle, minHeight: undefined }}>
                  <div aria-hidden className="absolute inset-0" style={musicSurfaceStyle} />
                  <div className="relative z-10 px-4 py-3">
                    {/* Player layout: cover art left (spans full height) + right column */}
                    <div className="flex items-center gap-3">
                      {/* Cover art - spans full player height */}
                      {(p as any).music_show_cover && currentTrack.cover_url && (
                        <div
                          className={`flex-shrink-0 overflow-hidden ${isMobile ? 'h-14 w-14' : 'h-16 w-16'} ${currentTrack.display_as_record ? 'rounded-full' : 'rounded-lg'} ${currentTrack.display_as_record && currentTrack.spin_record ? 'animate-spin' : ''}`}
                          style={currentTrack.display_as_record && currentTrack.spin_record ? { animationDuration: '3s' } : undefined}
                        >
                          {/\.(mp4|webm|mov)(\?|$)/i.test(currentTrack.cover_url) ? (
                            <BackgroundVideo src={currentTrack.cover_url} className="h-full w-full object-cover" />
                          ) : (
                            <img loading="lazy" decoding="async" src={currentTrack.cover_url} alt="cover" className="h-full w-full object-cover" />
                          )}
                        </div>
                      )}
                      {/* Right column: title row + progress+controls row */}
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5" style={{ fontFamily: fontApplyMusic }}>
                        {/* Title row */}
                        {(((p.music_show_title !== false) || (p.music_show_artist !== false)) || ((p as any).music_show_cover && currentTrack.cover_url)) && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              {p.music_show_title !== false ? <div className={`truncate font-semibold ${isMobile ? 'text-xs' : 'text-sm'}`} style={{ color: hexToRgba(musicTextColor, 0.92) }}>{currentTrack.title || profile.music_title || 'Track'}</div> : null}
                              {p.music_show_artist !== false ? <div className="truncate text-xs" style={{ color: hexToRgba(musicTextColor, 0.6) }}>{currentTrack.artist || profile.music_artist || 'Unknown artist'}</div> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1" style={{ color: hexToRgba(musicTextColor, 0.6) }}>
                              <Sparkles className="h-3.5 w-3.5" />
                              <span className="text-xs">{currentTrackIndex + 1}/{playlist.length}</span>
                            </div>
                          </div>
                        )}
                        {/* Progress + controls row */}
                        <div className="flex items-center gap-2">
                          <div className="min-w-[32px] shrink-0 text-xs" style={{ color: hexToRgba(musicTextColor, 0.65) }}>{formatTime(currentTime)}</div>
                          <div
                            className={`group flex-1 cursor-pointer rounded-full bg-white/20 ${isMobile ? 'h-1.5' : 'h-1'}`}
                            style={isMobile ? { touchAction: 'none' } : undefined}
                            onClick={handleSeek}
                          >
                            <div className="h-full rounded-full transition-all" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%', backgroundColor: accentColor }} />
                          </div>
                          <div className="min-w-[32px] shrink-0 text-right text-xs" style={{ color: hexToRgba(musicTextColor, 0.65) }}>{formatTime(duration)}</div>
                          {/* Controls - pushed to the far right */}
                          <div className={`flex shrink-0 items-center ${isMobile ? 'gap-1.5' : 'gap-1'}`}>
                            <button type="button" onClick={handlePreviousTrack} aria-label="Previous track" title="Previous track" className={`flex items-center justify-center text-white/50 hover:text-white disabled:opacity-40 ${isMobile ? 'h-8 w-8' : 'h-6 w-6'}`} disabled={playlist.length <= 1}><SkipBack className={isMobile ? 'h-3.5 w-3.5' : 'h-3 w-3'} /></button>
                            <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} aria-pressed={isPlaying} title={isPlaying ? 'Pause' : 'Play'} className={`flex items-center justify-center text-white/70 hover:text-white ${isMobile ? 'h-8 w-8' : 'h-7 w-7'}`}>{isPlaying ? <Pause className={isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} /> : <Play className={isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}</button>
                            <button type="button" onClick={handleNextTrack} aria-label="Next track" title="Next track" className={`flex items-center justify-center text-white/50 hover:text-white disabled:opacity-40 ${isMobile ? 'h-8 w-8' : 'h-6 w-6'}`} disabled={playlist.length <= 1}><SkipForward className={isMobile ? 'h-3.5 w-3.5' : 'h-3 w-3'} /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

}

