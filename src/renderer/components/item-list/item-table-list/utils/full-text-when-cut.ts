// Pure: a cut table cell's full text as its native tooltip. No `/@/` import, no React.

/** The box measures a cut check reads; every Element has them. */
export interface CutBox {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
}

/** A box's horizontal edges in the viewport (a DOMRect has them). */
export interface Edges {
    left: number;
    right: number;
}

/** The cell element the pointer entered (an HTMLElement in the app). */
export interface FullTextTarget extends CutBox {
    querySelectorAll(selectors: string): ArrayLike<CutBox>;
    removeAttribute(name: string): void;
    setAttribute(name: string, value: string): void;
    textContent: null | string;
}

/** Whether a box's content runs past it: wider (one line) or taller (a clamped title). */
export function isCut(box: CutBox): boolean {
    if (box.clientWidth <= 0) return false;
    return box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
}

/**
 * B-271: whether a number cell's box runs past its cell's padding box (from `from`, `width` wide:
 * the cell's left edge plus its `clientLeft`, and its `clientWidth`). A number may use the cell's
 * padding and ends in an ellipsis inside it, so this is a guard: a box past the padding box would be
 * clipped by the cell, outside the box, where `isCut` cannot see it. Rects, not offsets (R17
 * review M-2): they do not depend on the offsetParent and they include the shift into the other
 * side's padding. Under half a px is rounding.
 */
export function runsPastItsCell(content: Edges, from: number, width: number): boolean {
    return content.left < from - 0.5 || content.right > from + width + 0.5;
}

/**
 * B-267: a text cell cut to one line with an ellipsis lets the pointer read the whole text. No
 * table cell offered that before (the title column has neither a `title` attribute nor a
 * tooltip), so a cell gets the native `title` attribute: it costs no node per cell, unlike a
 * tooltip component, and is set when the pointer enters, only when the cell (or a box inside it,
 * such as a genre badge) is cut. `fullText` names the text when the cell's own text does not read
 * as one line (badges have no separator between them). `partHidden` says that some of the text is
 * not drawn at all (genre badges past the ones that fit, or past the four a cell draws), which no
 * box measure shows.
 */
export function showFullTextWhenCut(
    element: FullTextTarget,
    fullText?: string,
    partHidden = false,
): void {
    const cut =
        partHidden || isCut(element) || Array.from(element.querySelectorAll('*')).some(isCut);
    const text = (fullText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (cut && text) element.setAttribute('title', text);
    else element.removeAttribute('title');
}
