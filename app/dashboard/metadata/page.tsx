import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/current-profile'
import MetadataClient from './client'

// Everything is free - metadata editor is available to all users.
export default async function MetadataPage() {
  const profile = await getCurrentProfile()

  if (!profile) redirect('/login')

  return <MetadataClient profile={profile} />
}
