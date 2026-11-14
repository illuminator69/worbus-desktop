import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './device-control.module.css';

import { DeviceRowsList } from '/@/renderer/features/hub/components/device-rows-list';
import { sendAct } from '/@/renderer/features/hub/utils/remote-queue';
import { useDeviceControlState } from '/@/renderer/features/player/hooks/use-device-control-state';
import { useHubMyDeviceId, useHubStore } from '/@/renderer/store';
import chipStyles from '/@/shared/components/chip/chip.module.css';
import { AppIconSelection, Icon } from '/@/shared/components/icon/icon';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

interface Label {
    icon: AppIconSelection;
    text: string;
}

/**
 * The bar's device control (F1): the transfer pill when it applies ("Transfer here" while another
 * device holds the session, "Switch to <name>" for a device that just connected), otherwise the
 * device icon alone. The icon opens a box that grows upward from the pill into the device list;
 * the label folds away as it opens. Nothing at all without a hub (device-control-state.ts).
 */
export const DeviceControl = () => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const { dismiss, state } = useDeviceControlState(open);
    const myId = useHubMyDeviceId();
    const castActive = useHubStore(
        (s) => s.devices.find((d) => d.id === s.activeDeviceId)?.platform === 'chromecast',
    );
    const slotRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const iconRef = useRef<HTMLButtonElement>(null);

    const label: Label | null =
        state.kind === 'transfer'
            ? { icon: 'deviceComputer', text: t('player.transferHere') }
            : state.kind === 'switch'
              ? { icon: 'deviceGeneric', text: t('player.switchTo', { device: state.target.name }) }
              : null;

    // The label stays rendered while it folds away (the list opening, or the proposal ending).
    const [shown, setShown] = useState<Label | null>(label);
    if (label && (label.text !== shown?.text || label.icon !== shown.icon)) setShown(label);

    const close = (refocus: boolean) => {
        setOpen(false);
        if (refocus) iconRef.current?.focus();
    };

    useEffect(() => {
        if (!open) return undefined;
        // The first device that can be chosen, else the first control in the box.
        const box = boxRef.current;
        (
            box?.querySelector<HTMLButtonElement>('button[data-device-row]:not(:disabled)') ??
            box?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        )?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            iconRef.current?.focus();
        };
        const onPointer = (e: PointerEvent) => {
            if (!slotRef.current?.contains(e.target as Node)) setOpen(false);
        };
        // Capture: an app-wide key handler on the document stops Escape before `window`.
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onPointer);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('pointerdown', onPointer);
        };
    }, [open]);

    if (state.kind === 'absent') return null;

    const act = () => {
        // The click sends the id it rendered, even if the proposal is ending as it lands.
        if (state.kind === 'transfer' && myId) {
            sendAct('transfer', { target: myId });
        } else if (state.kind === 'switch') {
            sendAct('transfer', { target: state.target.id });
            dismiss(state.target.id);
        }
    };

    const isPill = Boolean(label);

    return (
        <div className={styles.slot} onClick={(e) => e.stopPropagation()} ref={slotRef}>
            <div
                aria-label={t('player.connectToDevice')}
                className={clsx(styles.box, open && styles.open)}
                inert={!open}
                ref={boxRef}
                role="group"
            >
                <div className={styles.boxInner}>
                    <div className={styles.boxList}>
                        <DeviceRowsList />
                    </div>
                    <div className={styles.boxFooter}>{t('player.connectToDevice')}</div>
                </div>
            </div>
            <div className={clsx(styles.pill, isPill && !open && styles.pillOn)}>
                {shown && (
                    <Tooltip label={shown.text} openDelay={300}>
                        <button
                            aria-hidden={!isPill || open}
                            className={clsx(
                                chipStyles.chip,
                                styles.label,
                                (!isPill || open) && styles.labelOff,
                            )}
                            // m4: the accent pill reacts as upstream's filled Button (darker).
                            data-variant="filled"
                            onClick={(e) => {
                                e.stopPropagation();
                                act();
                            }}
                            tabIndex={isPill && !open ? 0 : -1}
                            type="button"
                        >
                            <Icon icon={shown.icon} />
                            <span className={styles.labelText}>{shown.text}</span>
                        </button>
                    </Tooltip>
                )}
                <Tooltip disabled={open} label={t('player.connectToDevice')} openDelay={0}>
                    <button
                        aria-expanded={open}
                        aria-label={t('player.connectToDevice')}
                        className={clsx(styles.icon, (castActive || open) && styles.iconAccent)}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (open) close(true);
                            else setOpen(true);
                        }}
                        ref={iconRef}
                        type="button"
                    >
                        <Icon icon="radio" size="lg" />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
};
