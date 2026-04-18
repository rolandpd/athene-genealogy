import { AbstractInputSuggest, App, TFile, TFolder } from 'obsidian';
import { t } from './i18n';

/**
 * Typeahead-Eingabe für Markdown-Dateien im Vault.
 * Verwendung in Settings:
 *   new FileSuggest(app, inputEl, path => { ... });
 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onSelectCb: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFile[] {
		const lq = query.toLowerCase();
		return this.app.vault.getMarkdownFiles()
			.filter(f => f.path.toLowerCase().includes(lq))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.setValue(file.path);
		this.onSelectCb(file.path);
		this.close();
	}
}

/**
 * Typeahead-Eingabe für Ordner im Vault.
 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private onSelectCb: (path: string) => void,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): TFolder[] {
		const lq = query.toLowerCase();
		const folders: TFolder[] = [];
		this.app.vault.getAllLoadedFiles().forEach(f => {
			if (f instanceof TFolder && f.path.toLowerCase().includes(lq)) {
				folders.push(f);
			}
		});
		return folders
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 20);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === '/' ? t('suggest.vaultRoot') : folder.path);
	}

	selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
		const val = folder.path === '/' ? '' : folder.path;
		this.setValue(val);
		this.onSelectCb(val);
		this.close();
	}
}
