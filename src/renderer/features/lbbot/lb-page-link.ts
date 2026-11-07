import { hostOfAddress } from '../../../shared/utils/hub-addresses.ts';
import { attentionCount } from '../sidebar/utils/sidebar-groups.ts';

/**
 * Worbus P4 (design §6.4, §6.5): the imports lb-bot could not finish filing, as one row in Needs
 * attention that links to lb-bot's own page. No import actions here. Pure (`node --test`).
 */

/** lb-bot's page port in the packaged Worbus Server. */
export const LB_PAGE_PORT = 8899;

/** The page's list of imports that need you. */
export const IMPORTS_PATH = '/#/needs/imports';

/**
 * Where Open in lb-bot goes: the hub's `webUrl` when it sent one; else, only while the address in
 * use is private (project 3's test: on the home network), plain `http` to that address's host on
 * :8899; else nowhere.
 */
export const lbPageLink = (
    webUrl: null | string | undefined,
    activeAddress: null | string | undefined,
    isPrivate: (address: string) => boolean,
): null | string => {
    const web = (webUrl ?? '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^/]/i.test(web)) return `${web}${IMPORTS_PATH}`;
    if (!activeAddress || !isPrivate(activeAddress)) return null;
    const host = hostOfAddress(activeAddress);
    if (!host) return null;
    return `http://${host.includes(':') ? `[${host}]` : host}:${LB_PAGE_PORT}${IMPORTS_PATH}`;
};

/**
 * `counts.imports` from a `/lb/attention` answer: a whole number at or above 0, else 0 (absent
 * from an lb-bot older than project 4). Every other key, known or not, is ignored.
 */
export const attentionImports = (answer: unknown): number => {
    const counts =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).counts : null;
    const n =
        counts && typeof counts === 'object' ? (counts as Record<string, unknown>).imports : 0;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
};

/** The to-fix number (the sidebar's badge): the ledger's own failures, plus the imports. */
export const toFixCount = (
    ledger: readonly { outcome: string; settled: boolean }[],
    attention: unknown,
): number => attentionCount(ledger) + attentionImports(attention);

/** The row, shown only when there is something to fix. */
export const importsRow = (
    imports: number,
    link: null | string,
): null | { count: number; link: null | string } => (imports > 0 ? { count: imports, link } : null);

export { serverVersionOf } from '../../../shared/utils/version-line.ts';
