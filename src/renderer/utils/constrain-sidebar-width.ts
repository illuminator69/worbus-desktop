export const constrainSidebarWidth = (num: number) => {
    if (num < 200) {
        return 200;
    }

    if (num > 320) {
        return 320;
    }

    return num;
};

export const constrainRightSidebarWidth = (num: number) => {
    if (num < 250) {
        return 250;
    }

    if (num > 960) {
        return 960;
    }

    return num;
};
