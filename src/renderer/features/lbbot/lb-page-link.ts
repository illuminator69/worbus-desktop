import type { LbBotAttentionFolder } from '../../../shared/utils/lbbot-attention.ts';

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
    const base = lbPageBase(webUrl, activeAddress, isPrivate);
    return base ? `${base}${IMPORTS_PATH}` : null;
};

/** lb-bot's page, by `lbPageLink`'s rule, with no path; null: nowhere to open. */
const lbPageBase = (
    webUrl: null | string | undefined,
    activeAddress: null | string | undefined,
    isPrivate: (address: string) => boolean,
): null | string => {
    const web = (webUrl ?? '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^/]/i.test(web)) return web;
    if (!activeAddress || !isPrivate(activeAddress)) return null;
    const host = hostOfAddress(activeAddress);
    if (!host) return null;
    return `http://${host.includes(':') ? `[${host}]` : host}:${LB_PAGE_PORT}`;
};

/** B-406: where a folder waiting to be filed opens: lb-bot's Placement on it (PROTOCOL §15.6). */
export const lbPlaceLink = (
    webUrl: null | string | undefined,
    activeAddress: null | string | undefined,
    isPrivate: (address: string) => boolean,
    id: string,
): null | string => {
    const base = lbPageBase(webUrl, activeAddress, isPrivate);
    return base && id ? `${base}/#/place/${encodeURIComponent(id)}` : null;
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

/**
 * `counts.folders` from a `/lb/attention` answer (B-406): the download folders waiting to be
 * filed; a whole number at or above 0, else 0.
 */
export const attentionFolderCount = (answer: unknown): number => {
    const counts =
        answer && typeof answer === 'object' ? (answer as Record<string, unknown>).counts : null;
    const n =
        counts && typeof counts === 'object' ? (counts as Record<string, unknown>).folders : 0;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
};

/**
 * B-406 (the owner's ruling, 2026-11-13): Library Matches' to-fix number (its sidebar badge and its
 * To fix chip): lb-bot's imports plus, while downloading is on, the folders waiting to be filed (the
 * phone's units; off, no folder is listed: filing one is a download's last step). The ledger's own
 * failures are Activity's badge (`attentionCount`) and are not added here: one number per thing.
 */
export const libraryToFixCount = (attention: unknown, downloadsOn: boolean): number =>
    attentionImports(attention) + (downloadsOn ? attentionFolderCount(attention) : 0);

/**
 * The to-fix number as it was before B-406's ruling: the ledger's failures plus lb-bot's imports and
 * folders. Kept for the P4 harness's arithmetic; no surface shows it any more.
 */
export const toFixCount = (
    ledger: readonly { outcome: string; settled: boolean }[],
    attention: unknown,
    downloadsOn = true,
): number => attentionCount(ledger) + libraryToFixCount(attention, downloadsOn);

/**
 * B-406: the To fix section, as the phone has it: its number is lb-bot's `imports + folders`
 * (counts, not the rows listed), the folders listed as main allowlisted them, `moreFolders` the
 * rows lb-bot's cap cut. Downloading off: no folder is listed or counted.
 */
export const toFixSection = (
    attention: unknown,
    downloadsOn: boolean,
): { count: number; folders: LbBotAttentionFolder[]; imports: number; moreFolders: number } => {
    const imports = attentionImports(attention);
    const a =
        attention && typeof attention === 'object' ? (attention as Record<string, unknown>) : {};
    const listed = Array.isArray(a.folders) ? (a.folders as LbBotAttentionFolder[]) : [];
    const folders = downloadsOn ? listed : [];
    const cut = typeof a.foldersCut === 'number' && a.foldersCut > 0 ? a.foldersCut : 0;
    const counted = downloadsOn ? attentionFolderCount(attention) : 0;
    return {
        count: imports + counted,
        folders,
        imports,
        moreFolders: downloadsOn ? Math.max(cut, counted - folders.length, 0) : 0,
    };
};

/** B-406: what a folder is: lb-bot's "Artist - Album" when it identified one, else `unidentified`
 *  (the caller's words, i18n'd: review L3). */
export const folderTitle = (folder: LbBotAttentionFolder, unidentified: string): string =>
    (folder.identified && folder.matchLabel.trim()) || unidentified;

/** B-406: how many files (`files`, the caller's words) and lb-bot's word for their format
 *  ("11 files · FLAC"). */
export const folderDetail = (
    folder: LbBotAttentionFolder,
    files: (count: number) => string,
): string =>
    [files(folder.fileCount), folder.formats.trim().toUpperCase()].filter(Boolean).join(' · ');

/** The row, shown only when there is something to fix. */
export const importsRow = (
    imports: number,
    link: null | string,
): null | { count: number; link: null | string } => (imports > 0 ? { count: imports, link } : null);

export { serverVersionOf } from '../../../shared/utils/version-line.ts';
