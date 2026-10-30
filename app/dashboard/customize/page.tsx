import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/current-profile'
import CustomizeClient from './client'

// Everything is free - the customize editor is fully unlocked for every user.
export default async function CustomizePage() {
  const profile = await getCurrentProfile()

  if (!profile) redirect('/login')

  return <CustomizeClient profile={profile} isPremium={true} />
}
