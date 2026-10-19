/* Provider registry. To add one: write src/providers/<name>.js exporting a default
 * { name, complete(...) }, import it here and add it to PROVIDERS. Pick it with the AI_PROVIDER var. */
import gemini from './gemini.js';
import openai from './openai.js';

export const PROVIDERS = { gemini, openai };
export const DEFAULT_PROVIDER = 'gemini';

export function getProvider(name, registry = PROVIDERS) {
  const key = String(name || DEFAULT_PROVIDER).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : null;
}
