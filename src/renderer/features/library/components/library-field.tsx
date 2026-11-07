import { forwardRef, type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './library-field.module.css';

import { Icon } from '/@/shared/components/icon/icon';

interface LibraryFieldProps {
    /** Shown at the right while the field is empty: what a search here asks. */
    hint: string;
    onChange: (value: string) => void;
    /** Down from the field: focus the first row. */
    onDown?: () => void;
    /** Enter in the field (a pasted link opens). */
    onEnter?: () => void;
    value: string;
}

/**
 * F6: the Library's one field (design brief 7.2). Escape clears the text, a second Escape leaves the
 * field; Down moves to the first row. No autofocus: it would take the keys meant for the app.
 */
export const LibraryField = forwardRef<HTMLInputElement, LibraryFieldProps>(
    ({ hint, onChange, onDown, onEnter, value }, ref) => {
        const { t } = useTranslation();
        const localRef = useRef<HTMLInputElement | null>(null);

        const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
            // The app's own hotkeys (play, Enter on a list) are not this field's business.
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                if (value) onChange('');
                else event.currentTarget.blur();
            } else if (event.key === 'ArrowDown' && onDown) {
                event.preventDefault();
                onDown();
            } else if (event.key === 'Enter' && onEnter) {
                event.preventDefault();
                onEnter();
            }
        };

        return (
            <div className={styles.field}>
                <Icon className={styles.icon} icon="search" size="lg" />
                <input
                    aria-label={t('page.library.fieldLabel')}
                    autoComplete="off"
                    className={styles.input}
                    data-library-field
                    maxLength={200}
                    onChange={(event) => onChange(event.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('page.library.fieldPlaceholder')}
                    ref={(node) => {
                        localRef.current = node;
                        if (typeof ref === 'function') ref(node);
                        else if (ref) ref.current = node;
                    }}
                    spellCheck={false}
                    type="text"
                    value={value}
                />
                {value ? (
                    <button
                        aria-label={t('common.clear')}
                        className={styles.clear}
                        onClick={() => {
                            onChange('');
                            localRef.current?.focus();
                        }}
                        type="button"
                    >
                        <Icon icon="x" size="md" />
                    </button>
                ) : (
                    <span aria-hidden className={styles.hint}>
                        {hint}
                    </span>
                )}
            </div>
        );
    },
);
