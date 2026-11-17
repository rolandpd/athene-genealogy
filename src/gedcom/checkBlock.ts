import { MarkdownRenderChild, MarkdownRenderer, moment, type MarkdownPostProcessorContext, type Plugin } from 'obsidian';
import type { AthenePluginSettings } from '../types';
import { t } from '../i18n';
import { CHECK_SECTIONS, isCheckSection, renderSection } from './report';
import { GEDBAS_PERSON_URL, runVaultChecks } from './reportCommand';

export const CHECK_BLOCK = 'athene-check';

/**
 * Codeblock `athene-check` mit dem Namen einer Prüfung, z. B.
 *
 *     ```athene-check
 *     plausibility
 *     ```
 *
 * Rendert die Prüfung beim Öffnen der Notiz frisch; der Button wiederholt sie nach Korrekturen.
 */
export function registerCheckBlock(plugin: Plugin, settings: () => AthenePluginSettings): void {
	plugin.registerMarkdownCodeBlockProcessor(CHECK_BLOCK, (source, el, ctx) => {
		const section = source.trim().split(/\s+/)[0] ?? '';
		if (!isCheckSection(section)) {
			el.createEl('p', { text: t('gedcom.unknownCheck', { name: section, names: CHECK_SECTIONS.join(', ') }) });
			return;
		}
		ctx.addChild(new CheckBlock(plugin, settings, section, el, ctx));
	});
}

class CheckBlock extends MarkdownRenderChild {
	constructor(
		private plugin: Plugin,
		private settings: () => AthenePluginSettings,
		private section: Parameters<typeof renderSection>[0],
		container: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(container);
	}

	onload(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const el = this.containerEl;
		el.empty();
		const bar = el.createDiv({ cls: 'athene-check-bar' });
		const button = bar.createEl('button', { text: t('gedcom.refresh') });
		const stamp = bar.createSpan({ cls: 'athene-check-stamp' });
		button.onclick = () => void this.render();
		const body = el.createDiv();
		try {
			const { result, refPath, hasReference } = await runVaultChecks(this.plugin.app, this.settings());
			const created = moment().format('DD.MM.YYYY HH:mm:ss');
			const markdown = renderSection(this.section, result, {
				created,
				referencePath: hasReference ? refPath : undefined,
				referenceSource: this.settings().gedcomReferenceSource || undefined,
				gedbasPersonUrl: GEDBAS_PERSON_URL,
			});
			stamp.setText(t('gedcom.checkedAt', { time: created }));
			await MarkdownRenderer.render(this.plugin.app, markdown, body, this.ctx.sourcePath, this);
		} catch (err) {
			console.error(err);
			body.setText(t('gedcom.reportFailed'));
		}
	}
}
