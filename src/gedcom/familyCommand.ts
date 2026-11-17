import { Notice, TFile, moment, normalizePath, type App } from 'obsidian';
import type { IdRegistry } from '../registry/IdRegistry';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { ConfirmModal } from '../modal/ConfirmModal';
import { renderFamilyNote } from './family';
import { runVaultChecks } from './reportCommand';
import { createUid, isValidUid } from './uid';

/**
 * Legt für alle Elternpaare im Export-Umfang fehlende Familien-Datensätze an
 * und ergänzt vorhandenen Familien eine UID. Fragt vorher nach.
 */
export async function createMissingFamilies(app: App, registry: IdRegistry, settings: AthenePluginSettings): Promise<void> {
	const config = settings.idTypes.find(type => type.name === settings.gedcomFamilyType);
	if (!config) {
		new Notice(t('family.typeMissing', { name: settings.gedcomFamilyType }));
		return;
	}
	const { result } = await runVaultChecks(app, settings);
	const model = result.model;
	const missing = result.families.missing;
	const withoutUuid = result.families.withoutUuid;
	const incomplete = result.families.incomplete;
	if (missing.length === 0 && withoutUuid.length === 0 && incomplete.length === 0) {
		new Notice(t('family.nothingToDo'));
		return;
	}

	new ConfirmModal(
		app,
		t('family.confirm.title'),
		t('family.confirm.message', { missing: missing.length, complete: incomplete.length, uuid: withoutUuid.length }),
		t('family.confirm.btnConfirm'),
		async () => {
			const created = moment().format('YYYY-MM-DD HH:mm');
			let count = 0;
			for (const pair of missing) {
				const id = await registry.commitNextId(config);
				const note = renderFamilyNote(
					id,
					createUid(),
					created,
					pair.father ? model.persons.get(pair.father) : undefined,
					pair.mother ? model.persons.get(pair.mother) : undefined,
					normalizePath(config.folder),
				);
				if (!app.vault.getAbstractFileByPath(note.folder)) await app.vault.createFolder(note.folder);
				if (app.vault.getAbstractFileByPath(note.path)) continue;
				await app.vault.create(note.path, note.content);
				count++;
			}
			const basename = (p: string) => model.persons.get(p)?.basename ?? p;
			for (const fix of incomplete) {
				const file = app.vault.getAbstractFileByPath(fix.family);
				if (!(file instanceof TFile)) continue;
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (!fm['Vater']) fm['Vater'] = `[[${basename(fix.father)}]]`;
					if (!fm['Mutter']) fm['Mutter'] = `[[${basename(fix.mother)}]]`;
				});
			}
			let uids = 0;
			for (const path of withoutUuid) {
				const file = app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) continue;
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (!isValidUid(fm['uuid'])) {
						fm['uuid'] = createUid();
						uids++;
					}
				});
			}
			new Notice(t('family.done', { created: count, complete: incomplete.length, uuid: uids }));
		},
	).open();
}
