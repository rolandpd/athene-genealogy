import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import type { IdRegistry } from '../registry/IdRegistry';
import type { IdTypeConfig } from '../types';
import { AtheneFactoryError, FileFactory } from '../factory/FileFactory';
import { t } from '../i18n';

export class NewEntityModal extends Modal {
	private filename = '';
	private selectedTemplate = '';
	private previewId = '';
	private textComp: TextComponent | null = null;
	private warningEl: HTMLElement | null = null;
	private factory: FileFactory;

	constructor(
		app: App,
		private registry: IdRegistry,
		private config: IdTypeConfig,
	) {
		super(app);
		this.factory = new FileFactory(app, registry);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('modal.title', { name: this.config.name }));

		// Peek next ID without incrementing the cache
		this.previewId = await this.registry.peekNextId(this.config);
		this.filename = this.previewId;
		this.selectedTemplate = this.config.templates[0] ?? '';

		// Filename field
		new Setting(contentEl)
			.setName(t('modal.filename.label'))
			.setDesc(t('modal.filename.desc', { id: this.previewId }))
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
				.setName(t('modal.template.label'))
				.addDropdown(dd => {
					for (const tpl of this.config.templates) {
						dd.addOption(tpl, tpl.split('/').pop() ?? tpl);
					}
					dd.setValue(this.selectedTemplate);
					dd.onChange(val => { this.selectedTemplate = val; });
				});
		} else if (this.config.templates.length === 1) {
			new Setting(contentEl)
				.setName(t('modal.template.label'))
				.setDesc(this.config.templates[0] ?? '');
		}

		// Buttons
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('modal.btnCancel'))
				.onClick(() => this.close()))
			.addButton(btn => btn
				.setButtonText(t('modal.btnCreate'))
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
				text: t('modal.idWarning', { id: this.previewId }) + ' ',
			});
			const link = this.warningEl.createEl('a', { text: t('modal.idWarningReset') });
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
			new Notice(t('modal.errNoFilename'));
			return;
		}

		// Close before factory runs — Templater needs an open leaf, not an open modal
		this.close();

		try {
			const result = await this.factory.createFile({
				config: this.config,
				filename: this.filename || undefined,
				templatePath: this.selectedTemplate || undefined,
			});
			new Notice(t('modal.noticeCreated', { type: this.config.name, name: result.filename }));
		} catch (e) {
			if (e instanceof AtheneFactoryError) {
				switch (e.code) {
					case 'FILE_EXISTS':
						new Notice(t('modal.errFileExists', { path: e.path ?? '' })); break;
					case 'CREATE_FAILED':
						new Notice(t('modal.errCreateFailed', { path: e.path ?? '' })); break;
					case 'TEMPLATE_NOT_FOUND':
						new Notice(t('modal.errTemplateNotFound', { path: e.path ?? '' })); break;
					case 'ID_PROPERTY_FAILED':
						new Notice(t('modal.errIdPropertyNotSet')); break;
				}
			}
		}
	}
}
