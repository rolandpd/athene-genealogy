import { Notice, TFile, moment, normalizePath, type App } from 'obsidian';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { runChecks } from './checks';
import { collectVaultModel } from './collect';
import { readGedcomIndividuals } from './gedcomReader';
import type { GedcomIndividual } from './model';
import { renderReport } from './report';

export const GEDBAS_PERSON_URL = 'https://gedbas.genealogy.net/person/show/';

/** Erstellt den GEDCOM-Prüfbericht und öffnet ihn. */
export async function createGedcomReport(app: App, settings: AthenePluginSettings): Promise<void> {
	let reference: GedcomIndividual[] | undefined;
	const refPath = settings.gedcomReferencePath ? normalizePath(settings.gedcomReferencePath) : '';
	if (refPath) {
		if (await app.vault.adapter.exists(refPath)) {
			reference = readGedcomIndividuals(await app.vault.adapter.read(refPath));
		} else {
			new Notice(t('gedcom.referenceMissing', { path: refPath }));
		}
	}

	const result = runChecks(
		collectVaultModel(app),
		{ currentYear: new Date().getFullYear(), livingYears: settings.gedcomLivingYears },
		reference,
	);
	const markdown = renderReport(result, {
		created: moment().format('DD.MM.YYYY HH:mm'),
		referencePath: reference ? refPath : undefined,
		gedbasPersonUrl: GEDBAS_PERSON_URL,
	});

	const reportPath = normalizePath(settings.gedcomReportPath);
	const existing = app.vault.getAbstractFileByPath(reportPath);
	let file: TFile;
	if (existing instanceof TFile) {
		await app.vault.modify(existing, markdown);
		file = existing;
	} else {
		const folder = reportPath.split('/').slice(0, -1).join('/');
		if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
		file = await app.vault.create(reportPath, markdown);
	}
	new Notice(t('gedcom.reportCreated', { count: result.scope.included.size }));
	await app.workspace.getLeaf(false).openFile(file);
}
