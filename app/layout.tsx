import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Mijn Kookmagazine', description: 'Een persoonlijke verzameling recepten om in te bladeren.' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body>{children}</body></html>
}
