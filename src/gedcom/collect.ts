import type { App, FrontMatterCache, TFile } from 'obsidian';
import { type VaultEvent, type VaultFamily, type VaultModel, type VaultPerson, linkText, normalizeEventType, parseWikilink } from './model';

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tagsOf = (fm: FrontMatterCache): string[] => asArray(fm.tags).map(String);
const hasTag = (tags: string[], root: string) => tags.some(t => t === root || t.startsWith(root + '/'));
/** "[[Klärungsbedarf|🔴]]" → "Klärungsbedarf" */
const linkTarget = (v: unknown): string | undefined => (typeof v === 'string' ? parseWikilink(v)?.target : undefined);
/** Alle Properties als Text (erster Listeneintrag, Wikilink → Anzeige). */
const textFields = (fm: FrontMatterCache): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(fm)) {
		const t = linkText(asArray(v)[0]);
		if (t) out[k] = t;
	}
	return out;
};
/** Erster Ort = Ort des Ereignisses, die weiteren sind genauere Angaben (Hof, Kirche). */
const places = (paths: string[]) => ({ place: paths[0], placeDetails: paths.length > 1 ? paths.slice(1) : undefined });
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

	const model: VaultModel = { persons: new Map(), events: [], families: [], places: new Map(), eventTypes: new Map() };
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
				...places(asArray(fm['Ort']).map(v => resolve(v, file)).filter((p): p is string => !!p)),
				placeText: asArray(fm['Ort']).find((v): v is string => typeof v === 'string' && !!v.trim() && !parseWikilink(v))?.trim(),
				description: linkText(fm['Beschreibung']),
				address: str(fm['Adresse']),
				fields: textFields(fm),
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
		} else if (hasTag(tags, 'System/Ereignistyp') && str(fm['gedcom'])) {
			const def = {
				gedcom: str(fm['gedcom'])!.toUpperCase(),
				gedcomType: str(fm['gedcomType']),
				gedcomValue: asArray(fm['gedcomValue']).map(String).filter(Boolean),
			};
			for (const name of [file.basename, ...asArray(fm['aliases']).map(String)]) {
				if (name.trim() && !model.eventTypes!.has(name.trim())) model.eventTypes!.set(name.trim(), def);
			}
		} else if (hasTag(tags, 'Orte')) {
			const loc = asArray(fm['location']).flatMap(v => String(v).replace(/[[\]\s]/g, '').split(',')).map(Number);
			const gov = asArray(fm['xrefs']).map(String).map(x => x.match(/gov\.genealogy\.net\/(?:item\/show\/)?([A-Za-z0-9_-]+)/)?.[1]).find(Boolean);
			model.places!.set(file.path, {
				path: file.path,
				name: file.basename.replace(/\s+P\d+$/, ''),
				address: str(fm['address']),
				gov,
				lat: loc.length === 2 && Number.isFinite(loc[0]) ? loc[0] : undefined,
				long: loc.length === 2 && Number.isFinite(loc[1]) ? loc[1] : undefined,
			});
		}
	}
	return model;
}
