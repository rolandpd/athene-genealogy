import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { FileFactory, EDIT_MODE } from './FileFactory';

// Das Paket "obsidian" enthält nur Typen — für den Test reichen TFile und normalizePath.
vi.mock('obsidian', () => {
	class TFile {
		constructor(public path: string) {}
		get basename() { return this.path.split('/').pop()!.replace(/\.md$/, ''); }
	}
	return { TFile, normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') };
});

const makeFile = (p: string) => new (TFile as unknown as new (path: string) => InstanceType<typeof TFile>)(p);

type Mode = 'source' | 'preview';

/**
 * Minimaler Obsidian-Nachbau: Ein Tab (leaf) zeigt eine Notiz in einem Modus.
 * Der Templater-Nachbau schreibt nur, wenn der Tab im Bearbeitungsmodus ist —
 * so wie das echte Templater, das in den aktiven Editor schreibt.
 */
function fakeApp(initialMode: Mode) {
	const files = new Map<string, string>();
	const handles = new Map<string, InstanceType<typeof TFile>>();
	const listeners: ((f: { path: string }) => void)[] = [];
	const leaf = {
		mode: initialMode,
		file: null as InstanceType<typeof TFile> | null,
		openFile: vi.fn(async (file: InstanceType<typeof TFile>, state?: { state?: { mode?: Mode } }) => {
			leaf.file = file;
			// Obsidian behält beim Wiederverwenden eines Tabs dessen Modus, wenn keiner angegeben ist
			if (state?.state?.mode) leaf.mode = state.state.mode;
		}),
	};
	const write = (path: string, content: string) => {
		files.set(path, content);
		listeners.forEach(l => l({ path }));
	};
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (files.has(p) ? handles.get(p) ?? null : p === 'Personen' ? {} : null),
			createFolder: vi.fn(),
			create: vi.fn(async (p: string, c: string) => {
				const f = makeFile(p);
				handles.set(p, f);
				files.set(p, c);
				return f;
			}),
			read: async (f: { path: string }) => files.get(f.path) ?? '',
			modify: async (f: { path: string }, c: string) => write(f.path, c),
			on: (_: string, cb: (f: { path: string }) => void) => { listeners.push(cb); return cb; },
			offref: () => undefined,
		},
		workspace: { getLeaf: () => leaf, setActiveLeaf: vi.fn() },
		fileManager: {
			processFrontMatter: async (f: { path: string }, fn: (fm: Record<string, unknown>) => void) => {
				const text = files.get(f.path) ?? '';
				const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
				const fm: Record<string, unknown> = {};
				for (const line of (m?.[1] ?? '').split('\n')) {
					const [k, ...v] = line.split(':');
					if (k?.trim()) fm[k.trim()] = v.join(':').trim();
				}
				fn(fm);
				const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
				write(f.path, `---\n${yaml}\n---\n${m ? text.slice(m[0].length) : text}`);
			},
		},
		plugins: {
			plugins: {
				'templater-obsidian': {
					templater: {
						write_template_to_file: vi.fn(async (_tpl: unknown, file: { path: string }) => {
							if (leaf.mode !== 'source' || leaf.file?.path !== file.path) return; // still scheitert
							write(file.path, '---\ntags: Personen\nuuid: \n---\n# Vorlage\n');
						}),
					},
				},
			},
		},
	};
	handles.set('Vorlagen/Person.md', makeFile('Vorlagen/Person.md'));
	files.set('Vorlagen/Person.md', 'roh');
	return { app, leaf, files };
}

const config = { id: 'p', name: 'Person', mask: 'I####', folder: 'Personen', templates: ['Vorlagen/Person.md'], idProperty: 'id', uidProperty: 'uuid' };
const registry = { commitNextId: async () => 'I0874' };

describe('FileFactory', () => {
	it('öffnet die neue Datei im Bearbeitungsmodus, auch wenn der Tab in der Leseansicht war', async () => {
		const { app, leaf, files } = fakeApp('preview');
		const factory = new FileFactory(app as never, registry as never);
		const result = await factory.createFile({ config, filename: 'Test, Person I0874' });

		expect(leaf.openFile).toHaveBeenCalledWith(result.file, EDIT_MODE);
		expect(leaf.mode).toBe('source');
		const text = files.get('Personen/Test, Person I0874.md') ?? '';
		expect(text).toContain('# Vorlage');
		expect(text).toContain('id: I0874');
		expect(text).toMatch(/uuid: [0-9a-f]{36}/);
	});
});
