import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';

import { askForPassword } from '/@/renderer/features/servers/utils/ask-for-password';
import { ServerSelector } from '/@/renderer/features/sidebar/components/server-selector';
import { useServerAuthenticated } from '/@/renderer/hooks/use-server-authenticated';
import { useAuthStore } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Center } from '/@/shared/components/center/center';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { AuthState } from '/@/shared/types/types';

/**
 * B-400: the session was refused and the password is being asked for. The library stays unmounted
 * (its queries would only be refused); the server's sign-in form is over this, and this page opens
 * it again after a Cancel. The server menu is here to choose another server.
 */
const PasswordNeeded = () => {
    const { t } = useTranslation();
    const server = useAuthStore((state) => state.currentServer);

    return (
        <Center h="100vh" p="md" w="100%">
            <Stack align="center" gap="md" maw="480px">
                <Text ta="center">{t('error.passwordNeeded', { server: server?.name ?? '' })}</Text>
                <Button
                    disabled={!server}
                    onClick={() => server && askForPassword(server, () => {})}
                    variant="filled"
                >
                    {t('error.passwordNeededAction')}
                </Button>
                <ServerSelector />
            </Stack>
        </Center>
    );
};

export const AuthenticationOutlet = () => {
    const authState = useServerAuthenticated();

    if (authState === AuthState.LOADING) {
        return (
            <Center h="100vh" w="100%">
                <Spinner container />
            </Center>
        );
    }

    if (authState === AuthState.PASSWORD_NEEDED) {
        return <PasswordNeeded />;
    }

    return <Outlet />;
};
