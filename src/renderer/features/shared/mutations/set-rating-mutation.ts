import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { useTranslation } from 'react-i18next';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { eventEmitter } from '/@/renderer/events/event-emitter';
import { UserRatingEventPayload } from '/@/renderer/events/events';
import { PreviousQueryData } from '/@/renderer/features/shared/mutations/favorite-optimistic-updates';
import {
    applyRatingOptimisticUpdates,
    restoreRatingQueryData,
} from '/@/renderer/features/shared/mutations/rating-optimistic-updates';
import { restorePayloads } from '/@/renderer/features/shared/mutations/rating-restore';
import { MutationHookArgs } from '/@/renderer/lib/react-query';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem, RatingResponse, SetRatingArgs } from '/@/shared/types/domain-types';

const setRatingMutationKey = ['set-rating'];

export const useSetRatingMutation = (args: MutationHookArgs) => {
    const { options } = args || {};
    const queryClient = useQueryClient();
    const { t } = useTranslation();

    return useMutation<
        RatingResponse,
        AxiosError,
        SetRatingArgs,
        { event: UserRatingEventPayload; queries: PreviousQueryData[] }
    >({
        mutationFn: (args) => {
            return api.controller.setRating({
                ...args,
                apiClientProps: { serverId: args.apiClientProps.serverId },
            });
        },
        mutationKey: setRatingMutationKey,
        onError: (_error, _variables, context) => {
            if (context) {
                restoreRatingQueryData(queryClient, context.queries);
                // n5: list rows, the queue and the hub mirror get back what they showed, not the
                // value that failed.
                restorePayloads(context.event).forEach((payload) =>
                    eventEmitter.emit('USER_RATING', payload),
                );
            }

            toast.show({
                message: _error.message,
                title: t('error.genericError') as string,
                type: 'error',
            });
        },
        onMutate: (variables) => {
            const event: UserRatingEventPayload = {
                id: variables.query.id,
                itemType: variables.query.type,
                previous: new Map(),
                rating: variables.query.rating,
                serverId: variables.apiClientProps.serverId,
            };
            eventEmitter.emit('USER_RATING', event);

            return {
                event,
                queries: applyRatingOptimisticUpdates(
                    queryClient,
                    variables,
                    variables.query.rating,
                ),
            };
        },
        onSuccess: (_data, variables) => {
            if (
                variables.query.type === LibraryItem.SONG ||
                variables.query.type === LibraryItem.PLAYLIST_SONG ||
                variables.query.type === LibraryItem.QUEUE_SONG
            ) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.albumArtists.favoriteSongs(
                        variables.apiClientProps.serverId,
                    ),
                });
            }
        },
        ...options,
    });
};

export const useIsMutatingRating = () => {
    const mutatingCount = useIsMutating({ mutationKey: setRatingMutationKey });
    return mutatingCount > 0;
};
