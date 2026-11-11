import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getDb } from '@/lib/db';
import { appMode } from '@/lib/mode';
import { getCaseFile } from '@/lib/views/disputes';
import { CaseFileView } from './case-file';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Case ${id}` };
}

export default async function CaseFilePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const cf = getCaseFile(getDb(), id);
  if (!cf) notFound();
  return <CaseFileView cf={cf} mode={appMode()} />;
}
