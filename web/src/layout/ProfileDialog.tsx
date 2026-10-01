import { ProfileManager } from './ProfileManager'
import { useWorkspace } from '../store/workspace'

/**
 * Connection profiles dialog, controlled by the workspace store. Mounts ProfileManager only while open so
 * edits and test results reset on every open.
 */
export function ProfileDialog() {
  const open = useWorkspace((s) => s.profileDialogOpen)
  return open ? <ProfileManager /> : null
}
