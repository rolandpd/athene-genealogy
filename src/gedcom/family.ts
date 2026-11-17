import type { VaultPerson } from './model';

/**
 * Familien-Datensätze als ID-Nachweis: Sie halten Vater, Mutter und eine UID fest,
 * damit eine Familie beim GEDCOM-Export immer dieselbe F-ID und `_UID` bekommt.
 * Personen und Heiraten verweisen (noch) nicht darauf.
 */

/** Untergruppe aus dem Personenpfad: "Personen/Zw-MayKlh/Mayr, Anna I0110.md" → "Zw-MayKlh" */
export function groupOf(personPath: string | undefined): string | undefined {
	const parts = personPath?.split('/') ?? [];
	return parts.length >= 3 ? parts[parts.length - 2] : undefined;
}

export interface FamilyNote {
	folder: string;
	path: string;
	content: string;
}

/** Erzeugt den Inhalt einer neuen Familien-Notiz im Format der vorhandenen F-Datensätze. */
export function renderFamilyNote(
	id: string,
	uid: string,
	created: string,
	father: VaultPerson | undefined,
	mother: VaultPerson | undefined,
	familyFolder: string,
): FamilyNote {
	const group = groupOf(father?.path) ?? groupOf(mother?.path);
	const rootTag = familyFolder.split('/').pop() || 'Familien';
	const folder = group ? `${familyFolder}/${group}` : familyFolder;
	const link = (p?: VaultPerson) => (p ? `"[[${p.basename}]]"` : '');
	const lines = [
		'---',
		'aliases:',
		'tags:',
		`  - ${group ? `${rootTag}/${group}` : rootTag}`,
		`id: ${id}`,
		`created: ${created}`,
		`Vater: ${link(father)}`.trimEnd(),
		`Mutter: ${link(mother)}`.trimEnd(),
		'Quelle:',
		`uuid: ${uid}`,
		'---',
		'',
		'Automatisch angelegt für den GEDCOM-Export (abgeleitet aus Geburts-, Elternschafts- und Heiratsereignissen).',
		'',
	];
	return { folder, path: `${folder}/${id}.md`, content: lines.join('\n') };
}
