import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { getPlaybook } from '@/lib/settings';
import { PlaybookEditor } from './playbook-editor';

export const metadata: Metadata = { title: 'Playbook' };

export default async function PlaybookPage() {
  await connection();
  return <PlaybookEditor initial={getPlaybook(getDb())} />;
}
