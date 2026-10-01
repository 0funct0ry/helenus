// Vite empties web/dist on build; Go embeds web/dist and needs it to exist
// even in a fresh checkout, so recreate the committed placeholder afterwards.
import { writeFileSync, mkdirSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
writeFileSync('dist/.gitkeep', '')
