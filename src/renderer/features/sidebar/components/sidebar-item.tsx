import clsx from 'clsx';
import { memo } from 'react';
import { Link, LinkProps, useLocation } from 'react-router';

import styles from './sidebar-item.module.css';

import { Button, ButtonProps } from '/@/shared/components/button/button';

interface SidebarItemProps extends Omit<ButtonProps, 'component' | 'ref'> {
    /** Every path that marks this row selected (the Library row's chip pages); wins over `selectedTo`. */
    selectedRoutes?: string[];
    /** The path that marks this row selected when it is not `to`; `''` means never selected. */
    selectedTo?: string;
    to: LinkProps['to'];
}

export const SidebarItem = ({
    children,
    className,
    selectedRoutes,
    selectedTo,
    to,
    ...props
}: SidebarItemProps) => {
    const location = useLocation();
    const toPath = selectedTo ?? (typeof to === 'string' ? to : to.pathname || '');
    const path =
        location.pathname.length > 1 ? location.pathname.replace(/\/+$/, '') : location.pathname;
    const isActive = selectedRoutes
        ? selectedRoutes.includes(path)
        : toPath !== '' && path === toPath;

    const handleLinkDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <Button
            className={clsx(
                {
                    [styles.active]: isActive,
                    [styles.disabled]: props.disabled,
                    [styles.link]: true,
                    [styles.root]: true,
                },
                className,
            )}
            classNames={{
                inner: styles.inner,
                label: styles.label,
            }}
            component={Link}
            draggable={false}
            onDragStart={handleLinkDragStart}
            to={to}
            variant="subtle"
            {...props}
        >
            {children}
        </Button>
    );
};

export const MemoizedSidebarItem = memo(SidebarItem);
