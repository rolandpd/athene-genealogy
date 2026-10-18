import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * Einfache Ja/Nein-Rückfrage vor destruktiven Aktionen.
 * `onConfirm` wird nur aufgerufen, wenn der Bestätigungs-Button geklickt wird.
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private confirmText: string,
		private onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(this.title);
		contentEl.createEl('p', { text: this.message });

		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText(t('confirm.cancel')).onClick(() => this.close());
				// Fokus auf „Abbrechen", damit Enter nichts löscht
				setTimeout(() => btn.buttonEl.focus(), 50);
			})
			.addButton(btn => btn
				.setButtonText(this.confirmText)
				.setWarning()
				.onClick(async () => {
					this.close();
					await this.onConfirm();
				}));
	}

	onClose() {
		this.contentEl.empty();
	}
}
