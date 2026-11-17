import { Notice, type App, type TFile } from 'obsidian';
import { t } from '../i18n';
import { ConfirmModal } from '../modal/ConfirmModal';
import { createUid, isValidUid } from './uid';

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Alle Notizen mit dem Tag (oder einem Untertag), denen das UID-Property fehlt. */
export function findFilesWithoutUid(app: App, tag: string, property: string, exclude: Set<string> = new Set()): TFile[] {
	return app.vault.getMarkdownFiles().filter(file => {
		if (exclude.has(file.path)) return false;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return false;
		const tags = asArray(fm.tags).map(String);
		if (!tags.some(x => x === tag || x.startsWith(tag + '/'))) return false;
		return !isValidUid(fm[property]);
	});
}

/** Fragt nach und vergibt dann fehlende UIDs für alle Personen (Vorlagen ausgenommen). */
export function assignMissingUids(app: App, tag: string, property: string, exclude: Set<string> = new Set()): void {
	const files = findFilesWithoutUid(app, tag, property, exclude);
	if (files.length === 0) {
		new Notice(t('uid.noneMissing', { tag }));
		return;
	}
	new ConfirmModal(
		app,
		t('uid.confirm.title'),
		t('uid.confirm.message', { count: files.length, tag, property }),
		t('uid.confirm.btnConfirm'),
		async () => {
			let done = 0;
			for (const file of files) {
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (!isValidUid(fm[property])) {
						fm[property] = createUid();
						done++;
					}
				});
			}
			new Notice(t('uid.assigned', { count: done }));
		},
	).open();
}
