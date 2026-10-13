import type { ReactNode } from 'react';
import '../src/styles.css';
export const metadata = { title: 'merge.foo · Work map', description: 'The shortest path to merged. A graph workspace for progressive PR review.' };
export default function RootLayout({children}:{children:ReactNode}) {
  return <html lang="en"><head><link rel="icon" href="/favicon.svg" /></head><body>{children}</body></html>;
}
