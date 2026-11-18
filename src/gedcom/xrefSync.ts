import { Notice, TFile, type App } from 'obsidian';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { ConfirmModal } from '../modal/ConfirmModal';
import { planXrefUpdates } from './xrefPlan';
import { runVaultChecks } from './reportCommand';

/** Command: GEDBAS-IDs aus der Referenz-GEDCOM in `xrefs` übernehmen. */
export async function syncReferenceXrefs(app: App, settings: AthenePluginSettings): Promise<void> {
	const source = settings.gedcomReferenceSource;
	if (!source) {
		new Notice(t('xrefSync.noSource'));
		return;
	}
	const { result, hasReference } = await runVaultChecks(app, settings);
	if (!hasReference) return;
	const updates = planXrefUpdates(result, source);
	if (updates.length === 0) {
		new Notice(t('xrefSync.upToDate'));
		return;
	}
	const changed = updates.filter(u => u.previous).length;
	new ConfirmModal(
		app,
		t('xrefSync.confirm.title'),
		t('xrefSync.confirm.message', { count: updates.length, added: updates.length - changed, changed, source }),
		t('xrefSync.confirm.btnConfirm'),
		async () => {
			let done = 0;
			for (const u of updates) {
				const file = app.vault.getAbstractFileByPath(u.path);
				if (!(file instanceof TFile)) continue;
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					fm['xrefs'] = u.xrefs;
				});
				done++;
			}
			new Notice(t('xrefSync.done', { count: done }));
		},
	).open();
}
