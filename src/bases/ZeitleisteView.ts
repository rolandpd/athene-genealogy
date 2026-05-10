import { App, BasesView, Keymap, QueryController } from 'obsidian';

export const ZEITLEISTE_VIEW_TYPE = 'athene-zeitleiste';

const CSS = `
.ztl {
  position: relative;
  padding-left: 28px;
}
.ztl::before {
  content: '';
  position: absolute;
  left: 12px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-base-30);
}
.ztl-event {
  position: relative;
  padding: 2px 0 8px 0;
}
.ztl-event::before {
  content: '';
  position: absolute;
  left: -21px;
  top: 4px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-accent);
  border: 2px solid var(--background-primary);
  box-sizing: border-box;
}
.ztl-event.ztl-phase-b::before { background: var(--color-green); }
.ztl-event.ztl-phase-d::before { background: var(--color-base-50); }
.ztl-event.ztl-phase-e::before { background: var(--color-base-40); }
.ztl-main {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  min-width: 0;
}
.ztl-date {
  color: var(--text-muted);
  font-size: 0.82em;
  white-space: nowrap;
  min-width: 5.5em;
  flex-shrink: 0;
}
.ztl-type {
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}
.ztl-type a { color: var(--text-normal); text-decoration: none; cursor: pointer; }
.ztl-type a:hover { text-decoration: underline; }
.ztl-ort {
  color: var(--text-muted);
  font-size: 0.9em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.ztl-dok {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 0.78em;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
}
.ztl-dok:hover { color: var(--text-muted); }
.ztl-sub {
  font-size: 0.82em;
  color: var(--text-muted);
  padding-top: 2px;
  line-height: 1.4;
}
/* zt-* classes are shared with the Beschreibungsfeld formula / bases-custom.css */
.ztl-sub .zt-person { white-space: nowrap; display: inline; }
.ztl-sub strong { font-weight: 600; color: var(--text-normal); }
.ztl-sub .zt-label { color: var(--text-faint); font-size: 0.9em; }
.ztl-sub .zt-sep { color: var(--text-faint); margin: 0 0.2em; }
`;

export class AtheneZeitleisteView extends BasesView {
	readonly type = ZEITLEISTE_VIEW_TYPE;

	private containerEl: HTMLElement;
	private readonly obsApp: App;
	private styleEl: HTMLStyleElement | null = null;

	constructor(controller: QueryController, parentEl: HTMLElement, app: App) {
		super(controller);
		this.obsApp = app;
		this.containerEl = parentEl.createDiv('ztl');
		this.styleEl = document.head.createEl('style', { text: CSS });
	}

	onunload(): void {
		this.styleEl?.remove();
		this.styleEl = null;
	}

	public onDataUpdated(): void {
		this.containerEl.empty();
		for (const group of this.data.groupedData) {
			for (const entry of group.entries) {
				this.renderEntry(entry);
			}
		}
	}

	private resolveWikilinks(s: string): string {
		return s.replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, target: string, display: string) =>
			display || target.split('/').pop()!.replace(/\.md$/, '')
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private getStr(entry: any, key: string): string {
		const v = entry.getValue(key);
		if (v == null) return '';
		if (typeof v.isEmpty === 'function') return v.isEmpty() ? '' : v.toString();
		const s = String(v);
		return s === 'null' || s === 'undefined' ? '' : s;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private renderEntry(entry: any): void {
		const datumPad     = this.getStr(entry, 'formula.DatumPad');
		const typeRaw      = this.getStr(entry, 'formula.Ereignistyp');
		const typeName     = typeRaw ? typeRaw.replace(/^.*\//, '').replace(/\.md$/, '') : '';
		const phase        = this.getStr(entry, 'formula.Phase');
		const ort          = this.resolveWikilinks(this.getStr(entry, 'note.Ort'));
		const beschreibung = this.getStr(entry, 'formula.Beschreibungsfeld');

		const eventEl = this.containerEl.createDiv('ztl-event');

		// Dot color by phase
		const phaseStr = phase.toLowerCase();
		if (phaseStr === 'b') eventEl.addClass('ztl-phase-b');
		else if (phaseStr === 'd') eventEl.addClass('ztl-phase-d');
		else if (phaseStr === 'e') eventEl.addClass('ztl-phase-e');

		const mainEl = eventEl.createDiv('ztl-main');

		// Date
		if (datumPad) {
			const iso = datumPad.replace(/-00-00$/, '').replace(/-00$/, '');
			mainEl.createSpan({ cls: 'ztl-date', text: iso });
		}

		// Ereignistyp as clickable link
		if (typeName) {
			const typeEl = mainEl.createSpan({ cls: 'ztl-type' });
			const a = typeEl.createEl('a', { text: typeName });
			a.onClickEvent((evt) => {
				if (evt.button !== 0 && evt.button !== 1) return;
				evt.preventDefault();
				void this.obsApp.workspace.openLinkText(typeRaw, '', Keymap.isModEvent(evt));
			});
		}

		// Ort
		if (ort) {
			mainEl.createSpan({ cls: 'ztl-ort', text: ort });
		}

		// Dok link (the event file itself)
		const dokEl = mainEl.createSpan({ cls: 'ztl-dok', text: entry.file.basename });
		dokEl.onClickEvent((evt) => {
			void this.obsApp.workspace.openLinkText(entry.file.path, '', Keymap.isModEvent(evt));
		});

		// Second line: persons / description (rendered as HTML)
		if (beschreibung) {
			const subEl = eventEl.createDiv({ cls: 'ztl-sub' });
			subEl.innerHTML = beschreibung;
		}
	}
}
