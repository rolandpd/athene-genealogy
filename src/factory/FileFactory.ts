import { App, TFile, normalizePath } from 'obsidian';
import type { IdRegistry } from '../registry/IdRegistry';
import type { IdTypeConfig } from '../types';

// Minimal interface for the Templater plugin API we use
interface TemplaterAPI {
	write_template_to_file(template: TFile, file: TFile): Promise<void>;
}
interface TemplaterPlugin {
	templater?: TemplaterAPI;
}
interface AppWithPlugins extends App {
	plugins?: { plugins?: Record<string, TemplaterPlugin | undefined> };
}

export class AtheneFactoryError extends Error {
	constructor(
		public readonly code: 'FILE_EXISTS' | 'CREATE_FAILED' | 'TEMPLATE_NOT_FOUND' | 'ID_PROPERTY_FAILED',
		public readonly path?: string,
	) {
		super(code);
	}
}

export interface CreateFileOptions {
	config: IdTypeConfig;
	/** Filename without extension. Omit to use the committed ID as filename. */
	filename?: string;
	/** Override template path. Falls back to config.templates[0] if omitted. */
	templatePath?: string;
	/**
	 * Open the file in the active leaf after creation.
	 * Required for Templater (which needs the file as the active view).
	 * When false, template content is copied verbatim instead.
	 * Default: true.
	 */
	openAfterCreate?: boolean;
}

export interface CreateFileResult {
	file: TFile;
	id: string;
	filename: string;
}

export class FileFactory {
	constructor(
		private app: App,
		private registry: IdRegistry,
	) {}

	async createFile(options: CreateFileOptions): Promise<CreateFileResult> {
		const { config, openAfterCreate = true } = options;

		const id = await this.registry.commitNextId(config);
		const filename = options.filename?.trim() || id;

		// Ensure target folder exists
		const folder = normalizePath(config.folder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// Create empty file
		const filePath = normalizePath(folder ? `${folder}/${filename}.md` : `${filename}.md`);
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			throw new AtheneFactoryError('FILE_EXISTS', filePath);
		}

		let file: TFile;
		try {
			file = await this.app.vault.create(filePath, '');
		} catch {
			throw new AtheneFactoryError('CREATE_FAILED', filePath);
		}

		// Open in leaf — required so Templater can write to the active editor
		if (openAfterCreate) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		}

		// Apply template
		const templatePath = options.templatePath ?? config.templates[0];
		if (templatePath) {
			await this.applyTemplate(file, templatePath, openAfterCreate);
		}

		// Set ID property in frontmatter
		if (config.idProperty) {
			const prop = config.idProperty;
			// Re-fetch file: Templater may have moved it (TFile.path is updated in-place by Obsidian)
			const currentFile = this.resolveFile(file, filePath);
			if (!currentFile) throw new AtheneFactoryError('ID_PROPERTY_FAILED');

			// Templater uses a debounced editor save — wait for the vault modify event
			// before calling processFrontMatter, otherwise the file is still empty on disk.
			await this.waitForTemplaterWrite(currentFile);
			await this.app.fileManager.processFrontMatter(currentFile, (fm: Record<string, unknown>) => {
				fm[prop] = id;
			});
			file = currentFile;
		}

		return { file, id, filename };
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private async applyTemplate(file: TFile, templatePath: string, useTemplater: boolean) {
		const tplFile = this.app.vault.getAbstractFileByPath(normalizePath(templatePath));
		if (!(tplFile instanceof TFile)) {
			throw new AtheneFactoryError('TEMPLATE_NOT_FOUND', templatePath);
		}

		if (useTemplater) {
			const appPlugins = (this.app as AppWithPlugins).plugins?.plugins;
			const templater = appPlugins?.['templater-obsidian']?.templater;
			if (templater?.write_template_to_file) {
				await templater.write_template_to_file(tplFile, file);
				return;
			}
		}

		// Fallback: copy template content verbatim
		const content = await this.app.vault.read(tplFile);
		await this.app.vault.modify(file, content);
	}

	private waitForTemplaterWrite(file: TFile): Promise<void> {
		return new Promise<void>(resolve => {
			void this.app.vault.read(file).then(content => {
				if (content.trim()) { resolve(); return; }

				const timer = setTimeout(resolve, 5000);
				const ref = this.app.vault.on('modify', (modified) => {
					if (modified.path === file.path) {
						clearTimeout(timer);
						this.app.vault.offref(ref);
						resolve();
					}
				});
			});
		});
	}

	private resolveFile(file: TFile, originalPath: string): TFile | null {
		const byCurrentPath = this.app.vault.getAbstractFileByPath(file.path);
		if (byCurrentPath instanceof TFile) return byCurrentPath;

		const byOriginalPath = this.app.vault.getAbstractFileByPath(originalPath);
		if (byOriginalPath instanceof TFile) return byOriginalPath;

		return null;
	}
}
