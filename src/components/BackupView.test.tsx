import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { BACKUP_SCHEMA_VERSION } from '../lib/backup';
import BackupView from './BackupView';

beforeEach(async () => {
  await db.entries.clear();
  localStorage.clear();
  mockStorageManager(undefined);
  mockShare(undefined, undefined);
  vi.restoreAllMocks();
});

function mockStorageManager(value: unknown) {
  Object.defineProperty(navigator, 'storage', { value, configurable: true });
}

function mockShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

function pickFile(container: HTMLElement, json: string, name = 'backup.json') {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, {
    target: { files: [new File([json], name, { type: 'application/json' })] },
  });
}

const backupJson = JSON.stringify({
  app: 'baby-journal',
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: '2026-11-27T09:00:00.000Z',
  entries: [
    { id: 42, createdAt: 500, type: 'note', text: 'Backup 1', attachments: [] },
    {
      id: 7,
      createdAt: 100,
      type: 'note',
      text: 'Backup 2',
      attachments: [
        { kind: 'photo', createdAt: 1, mime: 'image/png', dataBase64: 'aGk=' }, // "hi"
      ],
    },
  ],
});

describe('BackupView display', () => {
  it('shows "noch kein Backup" and no persistence row when unsupported', async () => {
    render(<BackupView onBack={() => {}} />);
    expect(await screen.findByText('noch kein Backup')).toBeTruthy();
    expect(screen.queryByText('Persistenten Speicher anfordern')).toBeNull();
  });

  it('shows the persistence row with helper text and hides it silently once persisted', async () => {
    let persisted = false;
    mockStorageManager({
      estimate: vi.fn().mockResolvedValue({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      persist: vi.fn(async () => {
        persisted = true;
        return true;
      }),
      persisted: vi.fn(async () => persisted),
    });
    render(<BackupView onBack={() => {}} />);

    expect(
      await screen.findByText('Schützt deine Daten davor, dass iOS den App-Speicher räumt.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Persistenten Speicher anfordern' }));

    // Granted: the whole row disappears — no residual checkmark line.
    await waitFor(() => expect(screen.queryByText('Persistenten Speicher anfordern')).toBeNull());
    expect(screen.queryByText(/beständig/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Speicher' })).toBeNull();
  });

  it('hides usage and the persistence row when storage is already persisted', async () => {
    const persisted = vi.fn(async () => true);
    mockStorageManager({
      estimate: vi.fn().mockResolvedValue({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      persist: vi.fn(),
      persisted,
    });
    render(<BackupView onBack={() => {}} />);

    await waitFor(() => expect(persisted).toHaveBeenCalled());
    expect(screen.queryByText(/Speicherverbrauch/)).toBeNull();
    expect(screen.queryByText('Persistenten Speicher anfordern')).toBeNull();
  });
});

describe('BackupView export', () => {
  it('exports via the share sheet and updates the last-backup date', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    mockShare(
      share,
      vi.fn(() => true),
    );
    render(<BackupView onBack={() => {}} />);

    await screen.findByText('noch kein Backup');
    fireEvent.click(screen.getByRole('button', { name: 'Backup jetzt erstellen' }));

    expect(await screen.findByText('Backup erstellt.')).toBeTruthy();
    expect(share).toHaveBeenCalledOnce();
    expect(screen.queryByText('noch kein Backup')).toBeNull();
  });

  it('shows a German error when the export fails', async () => {
    mockShare(
      vi.fn().mockRejectedValue(new Error('nope')),
      vi.fn(() => true),
    );
    render(<BackupView onBack={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Backup jetzt erstellen' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Export fehlgeschlagen – bitte erneut versuchen.',
    );
    expect(screen.queryByText('Backup erstellt.')).toBeNull();
  });
});

describe('BackupView import', () => {
  it('replaces all entries after confirmation, preserving ids and blobs', async () => {
    await db.entries.add({ createdAt: 1, type: 'note', text: 'Alt', attachments: [] });
    const { container } = render(<BackupView onBack={() => {}} />);

    pickFile(container, backupJson);
    // The count from the backup appears in the confirmation dialog.
    expect(
      await screen.findByText(
        'Bestehende Einträge werden gelöscht und durch das Backup ersetzt (2 Einträge).',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Wirklich importieren?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ja, importieren' }));
    expect(await screen.findByText('2 Einträge importiert.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    const entries = await db.entries.toArray();
    expect(entries.map((entry) => entry.id).sort((a, b) => a! - b!)).toEqual([7, 42]);
    const withPhoto = entries.find((entry) => entry.attachments.length === 1);
    expect(withPhoto?.text).toBe('Backup 2');
    // Blob bytes are verified in backup.test.ts (fake-indexeddb's
    // structuredClone cannot copy jsdom blobs, only the metadata survives here).
    expect(withPhoto?.attachments[0]?.kind).toBe('photo');
  });

  it('rejects an invalid file with a German error and no mutation', async () => {
    await db.entries.add({ createdAt: 1, type: 'note', text: 'Alt', attachments: [] });
    const { container } = render(<BackupView onBack={() => {}} />);

    pickFile(container, 'nope');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('kein gültiges JSON');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await db.entries.count()).toBe(1);
  });

  it('rejects other apps and versions without mutation', async () => {
    const { container } = render(<BackupView onBack={() => {}} />);
    pickFile(container, JSON.stringify({ app: 'other', schemaVersion: 1, entries: [] }));
    expect((await screen.findByRole('alert')).textContent).toContain('kein Baby-Tagebuch-Backup');
    pickFile(container, JSON.stringify({ app: 'baby-journal', schemaVersion: 99, entries: [] }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Format 99 wird nicht unterstützt',
    );
    expect(await db.entries.count()).toBe(0);
  });

  it('cancels the import without touching the database', async () => {
    await db.entries.add({ createdAt: 1, type: 'note', text: 'Alt', attachments: [] });
    const { container } = render(<BackupView onBack={() => {}} />);

    pickFile(container, backupJson);
    // The dialog opens focused on the safe cancel button.
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    const entries = await db.entries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe('Alt');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('returns to the calendar via the back button', async () => {
    const onBack = vi.fn();
    render(<BackupView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '‹ Zurück' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
