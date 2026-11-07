import { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { RoleGate, routeAccess } from '/@/renderer/features/hub/utils/hub-roles';
import { AppRoute } from '/@/renderer/router/routes';
import { hubCredentialPending, useHubStore } from '/@/renderer/store/hub.store';

/**
 * Worbus P2 (walk B1, B7): a page behind a role gate, opened directly (Back after a switch, a stale
 * link). For a user without the flag it is absent, as its sidebar entry is: the history entry is
 * replaced with Home. While a secret is in play and no user has been heard, nothing is painted,
 * so no cached answer of another account shows for a moment.
 */
export const RoleGatedRoute = ({ children, gate }: { children: ReactNode; gate: RoleGate }) => {
    const access = useHubStore((s) => routeAccess(s.user, hubCredentialPending(s), gate));
    if (access === 'leave') return <Navigate replace to={AppRoute.HOME} />;
    if (access === 'wait') return null;
    return children;
};
