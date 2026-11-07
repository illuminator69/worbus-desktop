import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';

import {
    type ArtistSort,
    parseLibraryParams,
    serializeLibraryParams,
} from '/@/renderer/features/library/library-model';
import { useScrollStore } from '/@/renderer/store/scroll.store';

const URL_WRITE_MS = 300;

// The text and sort held for a history entry when the page was left: the URL write is debounced, so
// text typed in the last moment before opening an artist would otherwise be missing on Back.
const heldPlaces = new Map<string, { q: string; sort: ArtistSort }>();

/**
 * F6 (Call 16): the Artists page keeps your place. The field's text is local state (a URL write per
 * keystroke would change `location.key` for every `useLocation` consumer); the text and sort are
 * written to the URL 300 ms after they settle, replacing the entry, never adding one. When the page is
 * left, the text, sort and list scroll offset are held under the entry's key and restored on Back.
 */
export const useLibraryPlace = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const navigationType = useNavigationType();
    const getOffset = useScrollStore((s) => s.getOffset);
    const setOffset = useScrollStore((s) => s.setOffset);

    const [initial] = useState(() => {
        const back = navigationType === 'POP';
        const held = back ? heldPlaces.get(location.key) : undefined;
        const url = parseLibraryParams(location.search);
        return {
            offset: back ? getOffset(location.key) : undefined,
            q: held?.q ?? url.q,
            sort: held?.sort ?? url.sort,
        };
    });
    const [text, setText] = useState(initial.q);
    const [sort, setSort] = useState<ArtistSort>(initial.sort);

    const keyRef = useRef(location.key);
    const pathRef = useRef(location.pathname);
    const searchRef = useRef(location.search);
    const placeRef = useRef({ q: text, sort });
    const offsetRef = useRef(initial.offset ?? 0);
    useEffect(() => {
        keyRef.current = location.key;
        pathRef.current = location.pathname;
        searchRef.current = location.search;
    }, [location.key, location.pathname, location.search]);
    useEffect(() => {
        placeRef.current = { q: text, sort };
    }, [text, sort]);

    useEffect(() => {
        const wanted = serializeLibraryParams({ q: text, sort });
        const shown = serializeLibraryParams(parseLibraryParams(searchRef.current));
        if (wanted === shown) return undefined;
        const id = window.setTimeout(() => {
            navigate(
                { pathname: pathRef.current, search: wanted ? `?${wanted}` : '' },
                { replace: true },
            );
        }, URL_WRITE_MS);
        return () => window.clearTimeout(id);
    }, [navigate, sort, text]);

    useEffect(
        () => () => {
            heldPlaces.set(keyRef.current, placeRef.current);
            setOffset(keyRef.current, offsetRef.current);
        },
        [setOffset],
    );

    const onScroll = useCallback((offset: number) => {
        offsetRef.current = offset;
    }, []);

    return { initialOffset: initial.offset, onScroll, setSort, setText, sort, text };
};
