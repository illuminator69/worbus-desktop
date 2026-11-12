import { closeModal, openModal } from '@mantine/modals';

import i18n from '/@/i18n/i18n';
import { EditServerForm } from '/@/renderer/features/servers/components/edit-server-form';
import { ServerListItem } from '/@/shared/types/domain-types';

const ASK_FOR_PASSWORD_MODAL = 'ask-for-password';

/**
 * B-338: the music server refused the session and the saved password could not be read here. Ask
 * for the password on the server's own form, over whatever is on screen; the server stays current,
 * so nothing that follows the account (the Worbus Server sign-in, its caches) moves. One form at a
 * time: every refused request in the burst lands here, and a second open with the same id is a
 * no-op.
 */
export const askForPassword = (server: ServerListItem): void => {
    openModal({
        children: (
            <EditServerForm
                isUpdate
                onCancel={() => closeModal(ASK_FOR_PASSWORD_MODAL)}
                // Only this form: it may have opened over another modal.
                onDone={() => closeModal(ASK_FOR_PASSWORD_MODAL)}
                password={null}
                server={server}
            />
        ),
        modalId: ASK_FOR_PASSWORD_MODAL,
        size: 'sm',
        title: i18n.t('form.updateServer.title') as string,
    });
};
