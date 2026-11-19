import { Notice, moment, normalizePath, type App } from 'obsidian';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { exportBlockers } from './report';
import { runVaultChecks } from './reportCommand';
import { readGedcomIndividuals } from './gedcomReader';
import { writeGedcom } from './writer';

/**
 * Schreibt den GEDCOM-Export in den Exportordner.
 * Bricht ab, solange der Prüfbericht Export-Hindernisse meldet.
 */
export async function exportGedcom(app: App, settings: AthenePluginSettings, version: string): Promise<void> {
	const { result } = await runVaultChecks(app, settings);
	const blockers = exportBlockers(result).filter(([, n]) => n > 0);
	if (blockers.length) {
		new Notice(t('gedcom.exportBlocked', { list: blockers.map(([k, n]) => `${k}: ${n}`).join(', ') }), 10000);
		return;
	}

	const { text, persons, families, estimatedDeaths } = writeGedcom(result, {
		created: new Date(),
		version,
		submitter: settings.gedcomSubmitter,
	});

	// Gegenprobe: jede GEDBAS-Person (außer Datenschutz/Lebend-Regel) muss mit ihrer UID wieder im Export stehen
	const exportedUids = new Set(readGedcomIndividuals(text).map(i => i.uid).filter(Boolean));
	const lost = (result.reference?.matches ?? []).filter(m => {
		if (!m.person || !result.scope.included.has(m.person)) return false;
		const uid = result.model.persons.get(m.person)?.uuid?.toLowerCase();
		return !uid || !exportedUids.has(uid);
	});

	const folder = normalizePath(settings.gedcomExportFolder || '/');
	if (folder !== '/' && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
	const path = normalizePath(`${folder === '/' ? '' : folder + '/'}${moment().format('YYYY-MM-DD')}-athene-export.ged`);
	await app.vault.adapter.write(path, text);
	new Notice(t('gedcom.exported', { path, persons, families, estimated: estimatedDeaths, lost: lost.length }), 10000);
}
