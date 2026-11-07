import { useEffect, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';

import {
    navDirection,
    type NavDirection,
    type NavType,
} from '/@/shared/components/animations/nav-direction';

// The history index of the last location a page saw (React Router keeps `idx` in history.state).
let lastIdx: null | number = null;

const currentIdx = (): null | number => {
    const idx = window.history.state?.idx;
    return typeof idx === 'number' ? idx : null;
};

/** Which way this page arrived, decided once when it mounts. */
export const useNavDirection = (): NavDirection => {
    const type = useNavigationType() as NavType;
    const { key } = useLocation();
    const [direction] = useState(() => navDirection(type, lastIdx, currentIdx()));

    // Every location change is recorded (a page kept mounted across params still moves the index);
    // StrictMode runs this twice in dev and the second write is the same value.
    useEffect(() => {
        lastIdx = currentIdx();
    }, [key]);

    return direction;
};
