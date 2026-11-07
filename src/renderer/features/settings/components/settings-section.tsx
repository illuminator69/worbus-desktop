import { Fragment, ReactNode, useContext, useEffect, useRef } from 'react';

import styles from './settings-search-results.module.css';
import sectionStyles from './settings-section.module.css';

import { Fold } from '/@/renderer/features/motion/fold';
import { SettingsTabContext } from '/@/renderer/features/settings/components/settings-context';
import { SettingsOptions } from '/@/renderer/features/settings/components/settings-option';
import {
    extraShown,
    foldedRows,
    sectionDrawn,
    sectionRows,
} from '/@/renderer/features/settings/components/settings-search';
import { useSettingSearchStore } from '/@/renderer/features/settings/store/search.store';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';

export type SettingOption = {
    control: ReactNode;
    description: ReactNode | string;
    /**
     * The row comes and goes with state (R30): while hidden it stays mounted, folded closed, and
     * folds open and closed with the app's `Fold` instead of appearing in one frame.
     */
    fold?: boolean;
    indent?: boolean;
    isHidden?: boolean;
    /** Names people use for this row that appear in no title (settings-keywords.ts). */
    keywords?: readonly string[];
    note?: string;
    title: string;
};

interface SettingsSectionProps {
    extra?: ReactNode;
    /** Words that find the `extra` block when the section's own title does not (search). */
    extraKeywords?: readonly string[];
    options: SettingOption[];
    title?: ReactNode;
}

export const SettingsSection = ({ extra, extraKeywords, options, title }: SettingsSectionProps) => {
    const { pendingScroll, search: keyword, setPendingScroll } = useSettingSearchStore();
    const tab = useContext(SettingsTabContext);
    const ref = useRef<HTMLDivElement>(null);
    const titleText = typeof title === 'string' ? title : '';

    const values = sectionRows(keyword, titleText, options);
    const rows = foldedRows(keyword, titleText, options);
    const folding = rows.some(({ row }) => row.fold);
    const showExtra = Boolean(extra) && extraShown(keyword, titleText, extraKeywords);
    const drawn = sectionDrawn(keyword, values.length, showExtra);

    // A search result opened this tab: scroll to the section it named, once.
    const wanted =
        pendingScroll !== null &&
        pendingScroll.tab === tab?.tab &&
        pendingScroll.section === titleText;
    useEffect(() => {
        if (!wanted || !drawn) return;
        ref.current?.scrollIntoView({ block: 'start' });
        setPendingScroll(null);
    }, [drawn, setPendingScroll, wanted]);

    if (!drawn) return null;

    // In the search results the heading says where the section lives and takes you there.
    const inResults = keyword !== '' && Boolean(tab?.open);
    const open = () => tab?.open?.(titleText);

    return (
        <Stack data-settings-section gap="md" ref={ref}>
            {title && (
                <TextTitle
                    className={inResults ? styles.resultHeading : undefined}
                    fw={600}
                    onClick={inResults ? open : undefined}
                    onKeyDown={
                        inResults
                            ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      open();
                                  }
                              }
                            : undefined
                    }
                    order={4}
                    role={inResults ? 'link' : undefined}
                    tabIndex={inResults ? 0 : undefined}
                >
                    {inResults ? `${tab?.label} › ${titleText || ''}` : title}
                </TextTitle>
            )}
            {folding ? (
                // R30: rows that come and go fold; each row carries its own gap so a closed one
                // leaves none, and the rows below move with the fold instead of jumping.
                <Stack gap={0} px="xl">
                    {rows.map(({ open, row }, index) => {
                        const body = (
                            <div className={index > 0 ? sectionStyles.foldingRow : undefined}>
                                <SettingsOptions {...row} />
                            </div>
                        );
                        return row.fold ? (
                            <Fold key={`option-${row.title}`} name={row.title} open={open}>
                                {body}
                            </Fold>
                        ) : (
                            <Fragment key={`option-${row.title}`}>{body}</Fragment>
                        );
                    })}
                    {showExtra && <div className={sectionStyles.foldingRow}>{extra}</div>}
                </Stack>
            ) : (
                <Stack gap="xl" px="xl">
                    {values.map((option) => (
                        <SettingsOptions key={`option-${option.title}`} {...option} />
                    ))}
                    {showExtra && extra}
                </Stack>
            )}
        </Stack>
    );
};
