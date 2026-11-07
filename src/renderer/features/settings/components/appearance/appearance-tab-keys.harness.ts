import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * F4:  node --test src/renderer/features/settings/components/appearance/appearance-tab-keys.harness.ts
 *
 * Appearance takes most of General's rows. Settings move in the UI, not in the store, so every
 * moved row must write the key it wrote before. This reads the sources of General, Appearance and
 * the one General section mounted from Advanced (custom CSS) and lists every store key they write:
 * `setSettings({...})` paths, the autoplay patch builders, the settings-store actions, the
 * electron-store keys and the localStorage keys. That set must equal what General wrote before F4
 * (BEFORE, taken from the F3 tree), less the one row F4 removes.
 */

const BEFORE = [
    'action:setArtistItems',
    'action:setArtistReleaseTypeItems',
    'action:setHomeItems',
    'action:setPlayerItems',
    'action:setSidebarItems',
    'electron:enableNeteaseTranslation',
    'electron:lyrics',
    'electron:resume',
    'setSettings:css.content',
    'setSettings:css.enabled',
    'setSettings:font....spread',
    'setSettings:font.builtIn',
    'setSettings:font.custom',
    'setSettings:font.system',
    'setSettings:font.type',
    'setSettings:general....spread',
    'setSettings:general.accent',
    'setSettings:general.albumBackground',
    'setSettings:general.albumBackgroundBlur',
    'setSettings:general.artistBackground',
    'setSettings:general.artistBackgroundBlur',
    'setSettings:general.autoSave....spread',
    'setSettings:general.autoSave.count',
    'setSettings:general.autoSave.enabled',
    'setSettings:general.blurExplicitImages',
    'setSettings:general.buttonSize',
    'setSettings:general.combinedLyricsAndVisualizer',
    'setSettings:general.confirmQueueChanges',
    'setSettings:general.coverColours',
    'setSettings:general.coverColoursMode',
    'setSettings:general.enableGridMultiSelect',
    'setSettings:general.externalLinks',
    'setSettings:general.followCurrentSong',
    'setSettings:general.followSystemTheme',
    'setSettings:general.fullscreenAutoOpenTimeout',
    'setSettings:general.homeFeature',
    'setSettings:general.homeFeatureStyle',
    'setSettings:general.imagePlaceholderPriority',
    'setSettings:general.imageRes....spread',
    'setSettings:general.imageRes.[option.value]',
    'setSettings:general.language',
    'setSettings:general.lastFM',
    'setSettings:general.listenBrainz',
    'setSettings:general.musicBrainz',
    'setSettings:general.nativeAspectRatio',
    'setSettings:general.nativeSpotify',
    'setSettings:general.pathReplace',
    'setSettings:general.pathReplaceWith',
    'setSettings:general.playButtonBehavior',
    'setSettings:general.playerbarOpenDrawer',
    'setSettings:general.playerbarSlider....spread',
    'setSettings:general.playerbarSlider.barAlign',
    'setSettings:general.playerbarSlider.barGap',
    'setSettings:general.playerbarSlider.barRadius',
    'setSettings:general.playerbarSlider.barWidth',
    'setSettings:general.playerbarSlider.loadingDelay',
    'setSettings:general.playerbarSlider.stretched',
    'setSettings:general.playerbarSlider.type',
    'setSettings:general.primaryShade',
    'setSettings:general.qobuz',
    'setSettings:general.resume',
    'setSettings:general.showFavorites',
    'setSettings:general.showLyricsInSidebar',
    'setSettings:general.showQueueInSidebar',
    'setSettings:general.showRatings',
    'setSettings:general.showVisualizerInSidebar',
    'setSettings:general.sideQueueLayout',
    'setSettings:general.sideQueueType',
    'setSettings:general.sidebarCollapsedNavigation',
    'setSettings:general.sidebarImageEnabled',
    'setSettings:general.sidebarPlaylistFolderSeparator',
    'setSettings:general.sidebarPlaylistFolderTreeIndent',
    'setSettings:general.sidebarPlaylistFolderTreeLineColor',
    'setSettings:general.sidebarPlaylistFolderView',
    'setSettings:general.sidebarPlaylistFolders',
    'setSettings:general.sidebarPlaylistList',
    'setSettings:general.sidebarPlaylistListFilterRegex',
    'setSettings:general.sidebarPlaylistMode',
    'setSettings:general.sidebarPlaylistSorting',
    'setSettings:general.skipButtons....spread',
    'setSettings:general.skipButtons.enabled',
    'setSettings:general.skipButtons.skipBackwardSeconds',
    'setSettings:general.skipButtons.skipForwardSeconds',
    'setSettings:general.spotify',
    'setSettings:general.theme',
    'setSettings:general.themeDark',
    'setSettings:general.themeLight',
    'setSettings:general.useThemeAccentColor',
    'setSettings:general.useThemePrimaryShade',
    'setSettings:general.volumeWheelStep',
    'setSettings:general.volumeWidth',
    'setSettings:general.zoomFactor',
    'setSettings:lyrics....spread',
    'setSettings:queryBuilder.tag',
];

const REMOVED = ['setSettings:general.sidebarCollapsedNavigation'];

const COMPONENTS = new URL('../', import.meta.url).pathname;

// --- the extractor ------------------------------------------------------------------------------

const skipExpr = (s: string, start: number): number => {
    let depth = 0;
    let quote: null | string = null;
    let i = start;
    while (i < s.length) {
        const c = s[i];
        if (quote) {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === quote) quote = null;
        } else if (c === "'" || c === '"' || c === '`') quote = c;
        else if ('([{'.includes(c)) depth += 1;
        else if (')]}'.includes(c)) {
            if (depth === 0) return i;
            depth -= 1;
        } else if (c === ',' && depth === 0) return i;
        i += 1;
    }
    return i;
};

const parseObject = (s: string, start: number, prefix: string, out: Set<string>): number => {
    let i = start + 1;
    while (i < s.length) {
        while (i < s.length && ' \t\r\n,'.includes(s[i])) i += 1;
        if (i >= s.length) break;
        if (s[i] === '}') return i + 1;
        if (s.startsWith('...', i)) {
            i = skipExpr(s, i + 3);
            out.add(`${prefix}...spread`);
            continue;
        }
        const m = /^(?:\[[^\]]*\]|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)/.exec(s.slice(i));
        if (!m) {
            i += 1;
            continue;
        }
        const key = m[0].replace(/^['"]|['"]$/g, '');
        i += m[0].length;
        while (i < s.length && ' \t\r\n'.includes(s[i])) i += 1;
        if (s[i] === ':') {
            i += 1;
            while (i < s.length && ' \t\r\n'.includes(s[i])) i += 1;
            if (s[i] === '{') {
                i = parseObject(s, i, `${prefix}${key}.`, out);
                continue;
            }
            out.add(prefix + key);
            i = skipExpr(s, i);
        } else {
            out.add(prefix + key);
        }
    }
    return i;
};

const BUILDERS: Record<string, string[]> = {
    'autoplayEnabledPatch(': ['autoDJ.enabled'],
    'stationCharacterPatch(': ['station.character'],
    'strategyPatch(': ['autoDJ.songStrategy', 'autoDJ.albumStrategy'],
};

export const writesOf = (s: string): Set<string> => {
    const result = new Set<string>();
    for (const m of s.matchAll(/setSettings\(\s*/g)) {
        const at = m.index + m[0].length;
        if (s[at] === '{') {
            const out = new Set<string>();
            parseObject(s, at, '', out);
            out.forEach((k) => result.add(`setSettings:${k}`));
        } else {
            const builder = Object.keys(BUILDERS).find((b) => s.startsWith(b, at));
            if (builder) BUILDERS[builder].forEach((k) => result.add(`setSettings:${k}`));
            else result.add('setSettings:<non-literal argument>');
        }
    }
    for (const m of s.matchAll(/localSettings\??\.set\(\s*'([^']+)'/g))
        result.add(`electron:${m[1]}`);
    for (const m of s.matchAll(/localStorage\.(?:setItem|removeItem)\(\s*'([^']+)'/g)) {
        result.add(`localStorage:${m[1]}`);
    }
    for (const m of s.matchAll(/const\s*\{([^}]*)\}\s*=\s*useSettingsStoreActions\(\)/g)) {
        for (const raw of m[1].split(',')) {
            const name = raw.trim().split(':')[0].trim();
            if (!name || name === 'setSettings') continue;
            if ((s.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length >= 2) {
                result.add(`action:${name}`);
            }
        }
    }
    return result;
};

const files = (dir: string): string[] =>
    (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((entry) =>
        entry.isDirectory()
            ? files(join(dir, entry.name))
            : /\.tsx$/.test(entry.name)
              ? [join(dir, entry.name)]
              : [],
    );

const keysFrom = (paths: string[]): string[] => {
    const all = new Set<string>();
    for (const path of paths) writesOf(readFileSync(path, 'utf8')).forEach((k) => all.add(k));
    return [...all].sort();
};

// --- the tests ----------------------------------------------------------------------------------

test('theExtractorReadsNestedSpreadShorthandAndBuilderWrites', () => {
    const got = writesOf(`
        setSettings({ general: { ...settings, a: 1, deep: { x: 2, y: 3 }, short } });
        setSettings(autoplayEnabledPatch(on));
        localSettings?.set('resume', true);
        const { setArtistItems, unused } = useSettingsStoreActions();
        setArtistItems(items);
    `);
    assert.deepEqual(
        [...got].sort(),
        [
            'action:setArtistItems',
            'electron:resume',
            'setSettings:autoDJ.enabled',
            'setSettings:general....spread',
            'setSettings:general.a',
            'setSettings:general.deep.x',
            'setSettings:general.deep.y',
            'setSettings:general.short',
        ].sort(),
    );
});

const afterFiles = () => [
    ...files(join(COMPONENTS, 'general')),
    ...files(join(COMPONENTS, 'appearance')),
    join(COMPONENTS, 'advanced/styles-settings.tsx'),
];

test('generalAndAppearanceTogetherWriteWhatGeneralWroteLessTheRemovedRow', () => {
    const expected = BEFORE.filter((k) => !REMOVED.includes(k)).sort();
    assert.deepEqual(keysFrom(afterFiles()), expected);
});

test('theRemovedRowIsReallyGoneAndWasWrittenBefore', () => {
    for (const key of REMOVED) {
        assert.ok(BEFORE.includes(key), `${key} was one of the keys before`);
        assert.ok(!keysFrom(afterFiles()).includes(key), `${key} must no longer be written`);
    }
    const sidebarSource = readFileSync(join(COMPONENTS, 'general/sidebar-settings.tsx'), 'utf8');
    assert.doesNotMatch(sidebarSource, /sidebarCollapsedNavigation/);
});

test('appearanceCarriesTheLooksAndGeneralKeepsQueueLinksAndLyrics', () => {
    const general = readFileSync(join(COMPONENTS, 'general/general-tab.tsx'), 'utf8');
    for (const kept of ['QueueSettings', 'ExternalLinksSettings', 'LyricSettings']) {
        assert.match(general, new RegExp(kept));
    }
    for (const gone of [
        'ThemeSettings',
        'ApplicationSettings',
        'ControlSettings',
        'SidebarSettings',
    ]) {
        assert.doesNotMatch(general, new RegExp(gone));
    }
    const appearance = readFileSync(join(COMPONENTS, 'appearance/appearance-tab.tsx'), 'utf8');
    const order = [
        'ThemeSettings',
        'TextSettings',
        'PlayerBarSettings',
        'SideQueueSettings',
        'SidebarSettings',
        'HomeAppearanceSettings',
        'AlbumArtistSettings',
        'ListsImagesSettings',
        'FullscreenAppearanceSettings',
    ];
    const at = (name: string) => appearance.indexOf(`component: ${name},`);
    order.forEach((name) => assert.ok(at(name) >= 0, `${name} is on the Appearance tab`));
    assert.deepEqual(
        [...order].sort((a, b) => at(a) - at(b)),
        order,
    );
});

test('theColoursSectionStartsWithTheCoverColoursSwitch', () => {
    const theme = readFileSync(join(COMPONENTS, 'general/theme-settings.tsx'), 'utf8');
    const titles = [...theme.matchAll(/^\s+title: t\('setting\.(\w+)'\)/gm)].map((m) => m[1]);
    assert.deepEqual(titles.slice(0, 3), ['coverColours', 'coverColoursMode', 'useSystemTheme']);
});

test('themeAccentAndShadePickersStayEnabledWhileCoverColoursIsOn', () => {
    // R14: the theme still colours the seek-bar waveform, the browser remote and anything the
    // cover does not set, so none of the pickers is disabled by the cover switch.
    const theme = readFileSync(join(COMPONENTS, 'general/theme-settings.tsx'), 'utf8');
    assert.doesNotMatch(theme, /disabled=\{[^}]*coverColours/);
    assert.match(theme, /disabled=\{settings\.useThemeAccentColor\}/);
    assert.match(
        readFileSync(new URL('../../../../../i18n/locales/en.json', import.meta.url), 'utf8'),
        /"coverColours_description": "The playing cover tints the whole window\. Theme, accent and primary shade still colour/,
    );
});

test('theArtistPageSectionsAreSwitchesInThePagesOrderNamedAsThePageNamesThem', () => {
    const source = readFileSync(join(COMPONENTS, 'general/artist-settings.tsx'), 'utf8');
    const head = source.slice(
        source.indexOf('const ARTIST_SECTIONS'),
        source.indexOf('const ARTIST_RELEASE_TYPE_ITEMS'),
    );
    assert.doesNotMatch(head, /DraggableItems|artistConfiguration/);
    const labels = [...head.matchAll(/'(page\.albumArtistDetail\.\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(labels, [
        'page.albumArtistDetail.popular',
        'page.albumArtistDetail.discographyKicker',
        'page.albumArtistDetail.aboutHeading',
        'page.albumArtistDetail.relatedArtists',
    ]);
    assert.match(head, /<Switch/);
});
