import { beforeEach, expect, it } from 'vitest';
import { db } from './db';

beforeEach(async () => {
  await db.entries.clear();
});

it('speichert und liest Einträge mit Anhängen', async () => {
  const blob = new Blob(['fake-image-data'], { type: 'image/png' });
  const id = await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Erster Eintrag',
    attachments: [{ kind: 'photo', blob, createdAt: Date.now() }],
  });

  const entry = await db.entries.get(id);
  expect(entry?.text).toBe('Erster Eintrag');
  expect(entry?.attachments).toHaveLength(1);
  expect(entry?.attachments[0].kind).toBe('photo');
});
