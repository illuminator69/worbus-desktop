import clsx from 'clsx';
import { forwardRef, ReactNode } from 'react';
import { useLocation, useMatch } from 'react-router';

import styles from './collapsed-sidebar-item.module.css';

import { Flex } from '/@/shared/components/flex/flex';
import { Text } from '/@/shared/components/text/text';
import { createPolymorphicComponent } from '/@/shared/utils/create-polymorphic-component';

interface CollapsedSidebarItemProps {
    activeIcon: ReactNode;
    disabled?: boolean;
    icon: ReactNode;
    label: string;
    route?: string;
    /** Every path that marks the item selected (the Library row's chip pages); wins over `route`. */
    selectedRoutes?: string[];
}

const _CollapsedSidebarItem = forwardRef<HTMLDivElement, CollapsedSidebarItemProps>(
    (
        {
            activeIcon,
            disabled,
            icon,
            label,
            route,
            selectedRoutes,
            ...props
        }: CollapsedSidebarItemProps,
        ref,
    ) => {
        const match = useMatch(route || '/null');
        const { pathname } = useLocation();
        const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
        const isMatch = selectedRoutes ? selectedRoutes.includes(path) : Boolean(match);

        return (
            <Flex
                align="center"
                className={clsx({
                    [styles.active]: isMatch,
                    [styles.container]: true,
                    [styles.disabled]: disabled,
                })}
                direction="column"
                ref={ref}
                tabIndex={0}
                {...props}
            >
                {isMatch ? <div className={styles.activeTabIndicator} /> : null}
                {isMatch ? activeIcon : icon}
                <Text
                    className={clsx({
                        [styles.active]: isMatch,
                        [styles.textWrapper]: true,
                    })}
                    fw="600"
                    isMuted={!isMatch}
                    size="xs"
                >
                    {label}
                </Text>
            </Flex>
        );
    },
);

export const CollapsedSidebarItem = createPolymorphicComponent<'button', CollapsedSidebarItemProps>(
    _CollapsedSidebarItem,
);
