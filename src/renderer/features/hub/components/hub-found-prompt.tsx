import { closeAllModals, openModal } from '@mantine/modals';

import i18n from '/@/i18n/i18n';
import { chooseServer } from '/@/renderer/features/hub/utils/hub-signin-actions';
import { tapAddress } from '/@/renderer/features/settings/components/server/server-status';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { HubFound } from '/@/shared/utils/hub-addresses';
import { displayAddress, hostOfAddress } from '/@/shared/utils/hub-addresses';

/**
 * Worbus P3 (design §6.4): after a Navidrome sign-in whose look beside Navidrome found exactly
 * one server, Worbus for desktop's own confirm modal: the server's name and address, Sign in as <name>, and
 * Not now (remembered per server id, or per address for an older server, so it is asked once).
 */
export const openFoundPrompt = (opts: {
    found: HubFound;
    onNotNow: () => void;
    username: string;
}): void => {
    const { found, onNotNow, username } = opts;
    if (found.kind === 'notEncrypted') return;
    const t = i18n.t.bind(i18n);
    const address = tapAddress(found);
    const host = hostOfAddress(address) ?? displayAddress(address);
    // M8: closing it any other way (Esc, the backdrop, its close button) is Not now too - it is
    // asked once. Only the confirm tap is not.
    let answered = false;
    const notNow = () => {
        if (answered) return;
        answered = true;
        onNotNow();
    };
    openModal({
        children: (
            <ConfirmModal
                labels={{
                    cancel: t('setting.worbus.notNow'),
                    confirm:
                        found.kind === 'server'
                            ? t('setting.worbus.signInAs', { username })
                            : t('setting.worbus.useThisAddress'),
                }}
                onCancel={() => {
                    notNow();
                    closeAllModals();
                }}
                onConfirm={() => {
                    answered = true;
                    closeAllModals();
                    void chooseServer({ address, found, kind: 'found' });
                }}
            >
                <Stack gap="xs">
                    <Text>
                        {found.kind === 'server'
                            ? t('setting.worbus.foundRow', { address: host, name: found.name })
                            : t('setting.worbus.olderAt', { address: host })}
                    </Text>
                    <Text isMuted size="sm">
                        {t('setting.worbus.foundBeside')}
                    </Text>
                </Stack>
            </ConfirmModal>
        ),
        onClose: notNow,
        title: found.kind === 'server' ? found.name : t('setting.worbus.useThisAddress'),
    });
};
