import { Notice, TFile, moment, normalizePath, type App } from 'obsidian';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { runChecks, type CheckResult } from './checks';
import { collectVaultModel } from './collect';
import { readGedcomIndividuals } from './gedcomReader';
import type { GedcomIndividual } from './model';
import { renderReport } from './report';

export const GEDBAS_PERSON_URL = 'https://gedbas.genealogy.net/person/show/';

/** Vorlagen der ID-Typen tragen dieselben Tags wie echte Datensätze und werden ausgenommen. */
export function templatePaths(settings: AthenePluginSettings): Set<string> {
	return new Set(settings.idTypes.flatMap(type => type.templates).filter(Boolean).map(p => normalizePath(p)));
}

/**
 * Liest Vault und Referenz-GEDCOM und führt alle Prüfungen aus.
 * Gemeinsame Grundlage für Prüfbericht und Familien-Command, damit beide denselben Umfang sehen.
 */
export async function runVaultChecks(app: App, settings: AthenePluginSettings): Promise<{ result: CheckResult; refPath: string; hasReference: boolean }> {
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
		collectVaultModel(app, templatePaths(settings)),
		{
			currentYear: new Date().getFullYear(),
			livingYears: settings.gedcomLivingYears,
			referenceSource: settings.gedcomReferenceSource || undefined,
		},
		reference,
	);
	return { result, refPath, hasReference: !!reference };
}

/** Erstellt den GEDCOM-Prüfbericht und öffnet ihn. */
export async function createGedcomReport(app: App, settings: AthenePluginSettings): Promise<void> {
	const { result, refPath, hasReference } = await runVaultChecks(app, settings);
	const markdown = renderReport(result, {
		created: moment().format('DD.MM.YYYY HH:mm'),
		referencePath: hasReference ? refPath : undefined,
		referenceSource: settings.gedcomReferenceSource || undefined,
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
