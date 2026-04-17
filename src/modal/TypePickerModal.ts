import { App, FuzzySuggestModal } from 'obsidian';
import type { IdRegistry } from '../registry/IdRegistry';
import type { IdTypeConfig } from '../types';
import { NewEntityModal } from './NewEntityModal';

/**
 * Zeigt alle konfigurierten ID-Typen zur Auswahl an.
 * Wird vom Fallback-Command „Neu: Datei anlegen …" geöffnet, wenn mehr als ein Typ konfiguriert ist.
 */
export class TypePickerModal extends FuzzySuggestModal<IdTypeConfig> {
	constructor(
		app: App,
		private registry: IdRegistry,
		private types: IdTypeConfig[],
	) {
		super(app);
		this.setPlaceholder('Typ wählen …');
	}

	getItems(): IdTypeConfig[] {
		return this.types;
	}

	getItemText(item: IdTypeConfig): string {
		return item.name;
	}

	onChooseItem(item: IdTypeConfig): void {
		new NewEntityModal(this.app, this.registry, item).open();
	}
}
