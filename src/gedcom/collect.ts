import type { App, FrontMatterCache, TFile } from 'obsidian';
import { type VaultEvent, type VaultFamily, type VaultModel, type VaultPerson, linkText, normalizeEventType, parseWikilink } from './model';

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tagsOf = (fm: FrontMatterCache): string[] => asArray(fm.tags).map(String);
const hasTag = (tags: string[], root: string) => tags.some(t => t === root || t.startsWith(root + '/'));
/** "[[Klärungsbedarf|🔴]]" → "Klärungsbedarf" */
const linkTarget = (v: unknown): string | undefined => (typeof v === 'string' ? parseWikilink(v)?.target : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

/**
 * Liest Personen, Ereignisse und Familien aus dem metadataCache.
 * Typerkennung über die Tags `Personen`, `Ereignisse`, `Familien`.
 */
export function collectVaultModel(app: App, exclude: Set<string> = new Set()): VaultModel {
	const cache = app.metadataCache;
	const resolve = (raw: unknown, source: TFile): string | undefined => {
		const link = parseWikilink(raw);
		if (!link) return undefined;
		return cache.getFirstLinkpathDest(link.target, source.path)?.path;
	};

	const model: VaultModel = { persons: new Map(), events: [], families: [], places: new Map() };
	for (const file of app.vault.getMarkdownFiles()) {
		if (exclude.has(file.path)) continue;
		const fm = cache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		const tags = tagsOf(fm);

		if (hasTag(tags, 'Personen')) {
			const person: VaultPerson = {
				path: file.path,
				basename: file.basename,
				id: str(fm['id']),
				kekule: asArray(fm['kekule']).length > 0,
				uuid: str(fm['uuid']),
				sex: str(fm['Geschlecht']),
				privacy: str(fm['Datenschutz']),
				xrefs: asArray(fm['xrefs']).map(v => String(v).trim()).filter(Boolean),
				status: linkTarget(fm['status']),
				aliases: asArray(fm['aliases']).map(v => String(v).trim()).filter(Boolean),
			};
			model.persons.set(file.path, person);
		} else if (hasTag(tags, 'Ereignisse')) {
			const event: VaultEvent = {
				path: file.path,
				basename: file.basename,
				type: normalizeEventType(fm['Ereignis']),
				persons: asArray(fm['Person']).map(v => resolve(v, file)).filter((p): p is string => !!p),
				father: resolve(fm['Vater'], file),
				mother: resolve(fm['Mutter'], file),
				date: str(fm['Datum']),
				status: linkTarget(fm['status']),
				place: resolve(fm['Ort'], file),
				occupation: linkText(fm['Beruf']) ?? linkText(fm['Beschreibung']),
				kind: linkText(fm['Art']),
				religion: linkTarget(fm['Konfession']) ?? str(fm['Konfession']),
				privacy: str(fm['Datenschutz']),
			};
			model.events.push(event);
		} else if (hasTag(tags, 'Familien')) {
			const family: VaultFamily = {
				path: file.path,
				basename: file.basename,
				id: str(fm['id']),
				uuid: str(fm['uuid']),
				father: resolve(fm['Vater'], file),
				mother: resolve(fm['Mutter'], file),
			};
			model.families.push(family);
		} else if (hasTag(tags, 'Orte')) {
			model.places!.set(file.path, {
				path: file.path,
				name: file.basename.replace(/\s+P\d+$/, ''),
				address: str(fm['address']),
			});
		}
	}
	return model;
}
