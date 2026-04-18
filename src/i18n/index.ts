import i18next from 'i18next';
import { moment } from 'obsidian';
import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import it from './locales/it.json';
import pl from './locales/pl.json';
import ia from './locales/ia.json';

export async function initI18n(): Promise<void> {
	const lang = moment.locale().split('-')[0] ?? 'en';
	await i18next.init({
		lng: lang,
		fallbackLng: 'en',
		resources: {
			en: { translation: en },
			de: { translation: de },
			fr: { translation: fr },
			es: { translation: es },
			it: { translation: it },
			pl: { translation: pl },
			ia: { translation: ia },
		},
		interpolation: { escapeValue: false },
	});
}

export function t(key: string, options?: Record<string, unknown>): string {
	return i18next.t(key, options);
}
