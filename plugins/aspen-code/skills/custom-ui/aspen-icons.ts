/**
 * The icons Aspen's select, lookup and date controls draw, for custom UI to copy into
 * `typescript/src/`. The SDK ships no icon module, and a text glyph or emoji (`▾ ‹ › × 📅`)
 * is a different drawing in whatever font the browser picks — so the platform's own glyphs are
 * here, from its `@core/icons`. See `controls.md` for which part uses which.
 *
 * These paths are Google's Material Symbols (Outlined, weight 300, grade 0, optical size 24),
 * the set the platform renders, used under the Apache License 2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 */

export interface IconToken {
    readonly path: string;
    readonly viewBox: string;
}

export const ChevronDown: IconToken = {
    path: 'M480-357.85 253.85-584 296-626.15l184 184 184-184L706.15-584 480-357.85Z',
    viewBox: '0 -960 960 960',
};

export const Check: IconToken = {
    path: 'M382-253.85 168.62-467.23 211.38-510 382-339.38 748.62-706l42.76 42.77L382-253.85Z',
    viewBox: '0 -960 960 960',
};

export const Close: IconToken = {
    path: 'M256-213.85 213.85-256l224-224-224-224L256-746.15l224 224 224-224L746.15-704l-224 224 224 224L704-213.85l-224-224-224 224Z',
    viewBox: '0 -960 960 960',
};

export const Search: IconToken = {
    path: 'M781.69-136.92 530.46-388.16q-30 24.77-69 38.77-39 14-80.69 14-102.55 0-173.58-71.01-71.03-71.01-71.03-173.54 0-102.52 71.01-173.6 71.01-71.07 173.54-71.07 102.52 0 173.6 71.03 71.07 71.03 71.07 173.58 0 42.85-14.38 81.85-14.39 39-38.39 67.84l251.23 251.23-42.15 42.16ZM380.77-395.38q77.31 0 130.96-53.66 53.66-53.65 53.66-130.96t-53.66-130.96q-53.65-53.66-130.96-53.66t-130.96 53.66Q196.15-657.31 196.15-580t53.66 130.96q53.65 53.66 130.96 53.66Z',
    viewBox: '0 -960 960 960',
};

export const CalendarToday: IconToken = {
    path: 'M212.31-100Q182-100 161-121q-21-21-21-51.31v-535.38Q140-738 161-759q21-21 51.31-21h55.38v-84.61h61.54V-780h303.08v-84.61h60V-780h55.38Q778-780 799-759q21 21 21 51.31v535.38Q820-142 799-121q-21 21-51.31 21H212.31Zm0-60h535.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38H200v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85ZM200-607.69h560v-100q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H212.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v100Zm0 0V-720v112.31Z',
    viewBox: '0 -960 960 960',
};

export const ArrowLeft: IconToken = {
    path: 'm294.92-450 227.85 227.85L480-180 180-480l300-300 42.77 42.15L294.92-510H780v60H294.92Z',
    viewBox: '0 -960 960 960',
};

export const ArrowRight: IconToken = {
    path: 'M665.08-450H180v-60h485.08L437.23-737.85 480-780l300 300-300 300-42.77-42.15L665.08-450Z',
    viewBox: '0 -960 960 960',
};

export const Spinner: IconToken = {
    path: 'M479.88-100q-78.03 0-147.33-29.9-69.29-29.9-121.02-81.63-51.73-51.73-81.63-121.02-29.9-69.3-29.9-147.33 0-78.98 29.96-147.97 29.96-69 81.58-120.61 51.61-51.62 121.04-81.58T480-860q12.75 0 21.37 8.63 8.63 8.63 8.63 21.38 0 12.76-8.63 21.37Q492.75-800 480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-12.77 8.63-21.38 8.63-8.62 21.38-8.62 12.76 0 21.37 8.63Q860-492.75 860-480q0 77.99-29.96 147.42-29.96 69.43-81.58 121.04-51.61 51.62-120.61 81.58Q558.86-100 479.88-100Z',
    viewBox: '0 -960 960 960',
};

const SVG = 'http://www.w3.org/2000/svg';

/**
 * An inline SVG painted in `currentColor`, sized by a token: the part's own icon-size token
 * (`--ap-comp-select-chevron-icon-size`, `--ap-comp-datepicker-calicon-size`, …) or
 * `--ap-sem-icon-size-sm | -md | -lg`. Built through the document of the element it will join
 * — the global `document` is the guest iframe's, not the page's.
 *
 *   trigger.append(icon(trigger.ownerDocument, ChevronDown, 'var(--ap-comp-select-chevron-icon-size)'))
 *
 * In React: <svg aria-hidden fill="currentColor" viewBox={t.viewBox} style={{ width: s, height: s }}><path d={t.path} /></svg>
 */
export function icon(doc: Document, token: IconToken, size = 'var(--ap-sem-icon-size-md)', label?: string): SVGSVGElement {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', token.viewBox);
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    if (label === undefined) svg.setAttribute('aria-hidden', 'true');
    else { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
    svg.style.width = size;
    svg.style.height = size;
    svg.style.flex = 'none';
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', token.path);
    svg.append(path);
    return svg;
}
