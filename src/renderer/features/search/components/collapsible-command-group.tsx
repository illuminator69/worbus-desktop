import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ReactNode, useCallback, useState } from 'react';

import styles from './collapsible-command-group.module.css';

import { DURATION, EASING } from '/@/shared/components/animations/motion-tokens';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Paper } from '/@/shared/components/paper/paper';

interface CollapsibleCommandGroupProps {
    children: ReactNode;
    defaultExpanded?: boolean;
    expanded?: boolean;
    heading: string;
    onToggle?: () => void;
    subtitle?: ReactNode;
}

export function CollapsibleCommandGroup({
    children,
    defaultExpanded = true,
    expanded: controlledExpanded,
    heading,
    onToggle,
    subtitle,
}: CollapsibleCommandGroupProps) {
    const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
    // The fold always animates, except under reduced motion.
    const animated = !useReducedMotion();

    const isControlled = controlledExpanded !== undefined && onToggle !== undefined;
    const expanded = isControlled ? controlledExpanded : internalExpanded;

    const toggle = useCallback(() => {
        if (isControlled) {
            onToggle?.();
        } else {
            setInternalExpanded((prev) => !prev);
        }
    }, [isControlled, onToggle]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        },
        [toggle],
    );

    return (
        <div className={styles.root}>
            <Paper p="sm" radius="sm" withBorder>
                <div
                    className={styles.heading}
                    onClick={toggle}
                    onKeyDown={handleKeyDown}
                    role="button"
                    tabIndex={0}
                >
                    <Icon className={styles.chevron} icon={expanded ? 'dropdown' : 'arrowRightS'} />
                    <Group justify="space-between" w="100%">
                        <span>{heading}</span>
                        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
                    </Group>
                </div>
            </Paper>
            {animated ? (
                <AnimatePresence initial={false}>
                    {expanded && (
                        <motion.div
                            animate={{ height: 'auto', opacity: 1 }}
                            className={styles.items}
                            exit={{ height: 0, opacity: 0 }}
                            initial={{ height: 0, opacity: 0 }}
                            style={{ overflow: 'hidden' }}
                            transition={{
                                duration: DURATION.medium2 / 1000,
                                ease: EASING.emphasized,
                            }}
                        >
                            {children}
                        </motion.div>
                    )}
                </AnimatePresence>
            ) : (
                expanded && <div className={styles.items}>{children}</div>
            )}
        </div>
    );
}
