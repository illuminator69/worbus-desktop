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

/** B-272: a box's text as laid out (a Range's width, fractional) against the box's content width. */
export interface TextFit {
    contentWidth: number;
    textWidth: number;
}

/** Whether a box's content runs past it: wider (one line) or taller (a clamped title). */
export function isCut(box: CutBox): boolean {
    if (box.clientWidth <= 0) return false;
    return box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
}

/**
 * B-272: the DOM's `TextFit` for an element: its contents' laid-out width (a Range) and its content
 * box. Only called on a pointer entering a cell; null for a box with no text of its own.
 */
export function measureTextFit(box: CutBox): null | TextFit {
    const element = box as unknown as HTMLElement;
    if (typeof document === 'undefined' || !element.getBoundingClientRect) return null;
    if (!element.textContent?.trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const textWidth = range.getBoundingClientRect().width;
    const style = getComputedStyle(element);
    const contentWidth =
        element.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth);
    return { contentWidth, textWidth };
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
    measure?: (box: CutBox) => null | TextFit,
): void {
    // B-272: a cut under a pixel shows in the text's own width, not in the whole-px box measures.
    const cutHere = (box: CutBox) => isCut(box) || textRunsPast(measure?.(box) ?? null);
    const cut =
        partHidden || cutHere(element) || Array.from(element.querySelectorAll('*')).some(cutHere);
    const text = (fullText ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (cut && text) element.setAttribute('title', text);
    else element.removeAttribute('title');
}

/** B-272: text wider than its box by more than rounding is cut, though `scrollWidth` (whole px)
 *  may equal `clientWidth`: "Pop" at 24.38 px in a 24 px cell draws "P...". */
export function textRunsPast(fit: null | TextFit): boolean {
    return fit !== null && fit.contentWidth > 0 && fit.textWidth - fit.contentWidth > 0.01;
}
