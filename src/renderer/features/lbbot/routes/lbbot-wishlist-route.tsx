import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { WishlistList } from '/@/renderer/features/lbbot/components/wishlist-list';
import { useLbBotWishlist } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { Spinner } from '/@/shared/components/spinner/spinner';

/**
 * The Wishlist, a list page of its own (Worbus P1, F3): the albums kept for later, in both
 * downloads modes. It used to open the Downloads page on its Wishlist chip, which stays there
 * while downloading is on. The title is said once, in the page header, with the count beside it.
 */
const LbBotWishlistPage = () => {
    const { t } = useTranslation();
    const wishlist = useLbBotWishlist();
    return (
        <ForkListPage
            // A failed read shows no count rather than a badge that loads forever.
            count={
                wishlist.data ? wishlist.data.entries.length : wishlist.isLoading ? null : undefined
            }
            countLoading={wishlist.isLoading}
            title={t('naviConnect.wishlist.title')}
        >
            <WishlistList />
        </ForkListPage>
    );
};

const LbBotWishlistRoute = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotWishlistPage />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotWishlistRoute;
