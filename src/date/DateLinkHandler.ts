import type AtheneGenealogyPlugin from '../main';
import { AtheneDate } from '../date';

/** Matches YYYY, YYYY-MM, YYYY-MM-DD with optional EDTF qualifier (~, ?, %) */
const DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?[~?%]?$/;

function isDatumHref(href: string): boolean {
	return DATE_RE.test(href);
}

function decorateIfDate(el: Element): void {
	if (el.classList.contains('athene-date-link')) return;
	const href = el.getAttribute('data-href') ?? el.getAttribute('href') ?? '';
	if (!isDatumHref(href)) return;
	el.classList.add('athene-date-link');
	const display = AtheneDate.parse(href)?.toDisplay();
	// Override Obsidian's aria-label (shows raw href) with our formatted date
	if (display) el.setAttribute('aria-label', display);
}

function decorateDateLinks(container: HTMLElement): void {
	container.querySelectorAll('.internal-link').forEach(decorateIfDate);
}

export function setupDateLinks(plugin: AtheneGenealogyPlugin): void {
	// Markdown reading/preview views
	plugin.registerMarkdownPostProcessor(decorateDateLinks);

	// Property-View and other non-markdown contexts (MutationObserver)
	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const el = node as Element;
				if (el.classList.contains('internal-link')) decorateIfDate(el);
				el.querySelectorAll('.internal-link').forEach(decorateIfDate);
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
	plugin.register(() => observer.disconnect());

	// Suppress click → no file open/create
	plugin.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		if ((evt.target as Element).closest('.athene-date-link')) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	}, true);

	// Suppress Obsidian hover preview (workspace link-hover trigger fires on mouseover)
	plugin.registerDomEvent(document, 'mouseover', (evt: MouseEvent) => {
		if ((evt.target as Element).closest('.athene-date-link')) {
			evt.stopPropagation();
		}
	}, true);
}
