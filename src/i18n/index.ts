import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';

import es from './es';

export const translations = { es };

export const i18n = new I18n(translations);
i18n.enableFallback = true;
i18n.defaultLocale = 'es';

const device = getLocales()[0]?.languageCode ?? 'es';
i18n.locale = device in translations ? device : 'es';

export const t = (key: string, options?: object): string => i18n.t(key, options);
