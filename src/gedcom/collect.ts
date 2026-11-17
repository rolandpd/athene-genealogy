import type { App, FrontMatterCache, TFile } from 'obsidian';
import { type VaultEvent, type VaultFamily, type VaultModel, type VaultPerson, normalizeEventType, parseWikilink } from './model';

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tagsOf = (fm: FrontMatterCache): string[] => asArray(fm.tags).map(String);
const hasTag = (tags: string[], root: string) => tags.some(t => t === root || t.startsWith(root + '/'));
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

/**
 * Liest Personen, Ereignisse und Familien aus dem metadataCache.
 * Typerkennung über die Tags `Personen`, `Ereignisse`, `Familien`.
 */
export function collectVaultModel(app: App): VaultModel {
	const cache = app.metadataCache;
	const resolve = (raw: unknown, source: TFile): string | undefined => {
		const link = parseWikilink(raw);
		if (!link) return undefined;
		return cache.getFirstLinkpathDest(link.target, source.path)?.path;
	};

	const model: VaultModel = { persons: new Map(), events: [], families: [] };
	for (const file of app.vault.getMarkdownFiles()) {
		const fm = cache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		const tags = tagsOf(fm);

		if (hasTag(tags, 'Personen')) {
			const exportRaw: unknown = fm['Export'];
			const person: VaultPerson = {
				path: file.path,
				basename: file.basename,
				id: str(fm['id']),
				kekule: asArray(fm['kekule']).length > 0,
				uuid: str(fm['uuid']),
				sex: str(fm['Geschlecht']),
				privacy: str(fm['Datenschutz']),
				exportFlag: typeof exportRaw === 'boolean' ? exportRaw : undefined,
				gedbasRefs: asArray(fm['refs']).map(String).filter(r => r.includes('gedbas')),
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
		}
	}
	return model;
}
