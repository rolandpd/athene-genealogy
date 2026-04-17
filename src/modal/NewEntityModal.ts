import { App, Modal, Notice, Setting, TFile, TextComponent, normalizePath } from 'obsidian';
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

export class NewEntityModal extends Modal {
	private filename = '';
	private selectedTemplate = '';
	private previewId = '';
	private textComp: TextComponent | null = null;
	private warningEl: HTMLElement | null = null;

	constructor(
		app: App,
		private registry: IdRegistry,
		private config: IdTypeConfig,
	) {
		super(app);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(`New: ${this.config.name}`);

		// Peek next ID without incrementing the cache
		this.previewId = await this.registry.peekNextId(this.config);
		this.filename = this.previewId;
		this.selectedTemplate = this.config.templates[0] ?? '';

		// Filename field
		new Setting(contentEl)
			.setName('Filename')
			.setDesc('ID pre-filled — type the name in front, e.g. "Mustermann, Emil ' + this.previewId + '"')
			.addText(text => {
				this.textComp = text;
				text.setValue(this.filename).onChange(val => {
					this.filename = val.trim();
					this.updateWarning();
				});
				text.inputEl.addClass('athene-filename-input');
				setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.setSelectionRange(0, 0);
				}, 50);
			});

		// Inline warning (hidden initially)
		this.warningEl = contentEl.createDiv({ cls: 'athene-id-warning' });
		this.warningEl.hide();

		// Template selector
		if (this.config.templates.length > 1) {
			new Setting(contentEl)
				.setName('Template')
				.addDropdown(dd => {
					for (const tpl of this.config.templates) {
						dd.addOption(tpl, tpl.split('/').pop() ?? tpl);
					}
					dd.setValue(this.selectedTemplate);
					dd.onChange(val => { this.selectedTemplate = val; });
				});
		} else if (this.config.templates.length === 1) {
			new Setting(contentEl)
				.setName('Template')
				.setDesc(this.config.templates[0] ?? '');
		}

		// Buttons
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText('Create')
				.setCta()
				.onClick(() => { void this.create(); }));
	}

	onClose() {
		this.contentEl.empty();
	}

	// ── Private ──────────────────────────────────────────────────────────────

	private updateWarning() {
		if (!this.warningEl) return;
		const idMissing = !this.filename.includes(this.previewId);
		const hasProperty = !!this.config.idProperty;

		if (idMissing && !hasProperty) {
			this.warningEl.empty();
			this.warningEl.createSpan({
				text: `ID ${this.previewId} is not in the filename — it will be reassigned. `,
			});
			const link = this.warningEl.createEl('a', { text: 'Reset' });
			link.addEventListener('click', () => {
				this.filename = this.previewId;
				this.textComp?.setValue(this.previewId);
				this.warningEl?.hide();
			});
			this.warningEl.show();
		} else {
			this.warningEl.hide();
		}
	}

	private async create() {
		if (!this.filename && !this.config.idProperty) {
			new Notice('Please enter a filename.');
			return;
		}

		// Commit ID (increment cache)
		const id = await this.registry.commitNextId(this.config);

		// Fallback filename: use ID only if field was cleared
		const finalFilename = this.filename || id;

		// Ensure target folder exists
		const folder = normalizePath(this.config.folder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// Create file
		const filePath = normalizePath(
			folder ? `${folder}/${finalFilename}.md` : `${finalFilename}.md`
		);
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			new Notice(`File already exists: ${filePath}`);
			return;
		}

		let file: TFile;
		try {
			file = await this.app.vault.create(filePath, '');
		} catch {
			new Notice(`Error creating file: ${filePath}`);
			return;
		}

		// Close modal and open file — Templater needs the file as the active view
		this.close();
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		// Apply template (file is now the active view)
		if (this.selectedTemplate) {
			await this.applyTemplate(file, this.selectedTemplate);
		}

		// Set ID property after template so it overrides any placeholder
		if (this.config.idProperty) {
			const prop = this.config.idProperty;
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm[prop] = id;
			});
		}

		new Notice(`${this.config.name} created: ${finalFilename}`);
	}

	private async applyTemplate(file: TFile, templatePath: string) {
		const tplFile = this.app.vault.getAbstractFileByPath(normalizePath(templatePath));
		if (!(tplFile instanceof TFile)) {
			new Notice(`Template not found: ${templatePath}`);
			return;
		}

		// Use Templater if installed (requires file to be the active view)
		const appPlugins = (this.app as AppWithPlugins).plugins?.plugins;
		const templater = appPlugins?.['templater-obsidian']?.templater;
		if (templater?.write_template_to_file) {
			await templater.write_template_to_file(tplFile, file);
			return;
		}

		// Fallback: insert template content verbatim
		const content = await this.app.vault.read(tplFile);
		await this.app.vault.modify(file, content);
	}
}
