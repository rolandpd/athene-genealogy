import { App, Modal, Notice, Setting, TFile, TextComponent, normalizePath } from 'obsidian';
import type { IdRegistry } from '../registry/IdRegistry';
import type { IdTypeConfig } from '../types';

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
		this.titleEl.setText(`Neu: ${this.config.name}`);

		// Nächste ID vorausschauen (kein Inkrement)
		this.previewId = await this.registry.peekNextId(this.config);
		this.filename = this.previewId;
		this.selectedTemplate = this.config.templates[0] ?? '';

		// Dateiname-Feld
		new Setting(contentEl)
			.setName('Dateiname')
			.setDesc('ID bereits eingetragen — Namen voranstellen, z.B. "Mustermann, Emil ' + this.previewId + '"')
			.addText(text => {
				this.textComp = text;
				text.setValue(this.filename).onChange(val => {
					this.filename = val.trim();
					this.updateWarning();
				});
				text.inputEl.style.width = '100%';
				setTimeout(() => {
					text.inputEl.focus();
					text.inputEl.setSelectionRange(0, 0);
				}, 50);
			});

		// Inline-Warnung (zunächst versteckt)
		this.warningEl = contentEl.createDiv({ cls: 'athene-id-warning' });
		this.warningEl.hide();

		// Template-Auswahl
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
				.setButtonText('Abbrechen')
				.onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText('Anlegen')
				.setCta()
				.onClick(() => this.create()));
	}

	onClose() {
		this.contentEl.empty();
	}

	// ── Privat ──────────────────────────────────────────────────────────────

	private updateWarning() {
		if (!this.warningEl) return;
		const idMissing = !this.filename.includes(this.previewId);
		const hasProperty = !!this.config.idProperty;

		if (idMissing && !hasProperty) {
			this.warningEl.empty();
			this.warningEl.createSpan({
				text: `ID ${this.previewId} nicht im Dateinamen — wird beim Anlegen erneut vergeben. `,
			});
			const link = this.warningEl.createEl('a', { text: 'Zurücksetzen' });
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
			new Notice('Bitte einen Dateinamen eingeben.');
			return;
		}

		// ID committen (Cache inkrementieren)
		const id = await this.registry.commitNextId(this.config);

		// Fallback-Dateiname: nur ID wenn Feld leer gelassen
		const finalFilename = this.filename || id;

		// Zielordner sicherstellen
		const folder = normalizePath(this.config.folder);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// Datei anlegen
		const filePath = normalizePath(
			folder ? `${folder}/${finalFilename}.md` : `${finalFilename}.md`
		);
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			new Notice(`Datei existiert bereits: ${filePath}`);
			return;
		}

		let file: TFile;
		try {
			file = await this.app.vault.create(filePath, '');
		} catch {
			new Notice(`Fehler beim Anlegen: ${filePath}`);
			return;
		}

		// Modal schließen und Datei öffnen — Templater braucht die Datei als aktiven View
		this.close();
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		// Template anwenden (Datei ist jetzt aktiver View)
		if (this.selectedTemplate) {
			await this.applyTemplate(file, this.selectedTemplate);
		}

		// ID-Property setzen/überschreiben (nach Template, damit Platzhalter überschrieben werden)
		if (this.config.idProperty) {
			const prop = this.config.idProperty;
			await this.app.fileManager.processFrontMatter(file, fm => {
				fm[prop] = id;
			});
		}

		new Notice(`${this.config.name} angelegt: ${finalFilename}`);
	}

	private async applyTemplate(file: TFile, templatePath: string) {
		const tplFile = this.app.vault.getAbstractFileByPath(normalizePath(templatePath));
		if (!(tplFile instanceof TFile)) {
			new Notice(`Template nicht gefunden: ${templatePath}`);
			return;
		}

		// Templater bevorzugen, falls installiert (braucht Datei als aktiven View)
		const plugins = (this.app as any).plugins?.plugins as Record<string, any> | undefined;
		const templater = plugins?.['templater-obsidian']?.templater;
		if (templater?.write_template_to_file) {
			await templater.write_template_to_file(tplFile, file);
			return;
		}

		// Fallback: Template-Inhalt unverändert einfügen
		const content = await this.app.vault.read(tplFile);
		await this.app.vault.modify(file, content);
	}
}
