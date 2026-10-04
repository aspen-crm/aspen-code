/**
 * Harvest the design-system vocabulary from a running Aspen instance.
 *
 * Run this in the browser console on any signed-in page of the instance, or have the agent
 * evaluate it in the page. It returns a JSON-serialisable object; hand that to `write.mjs`.
 *
 * What it collects, and deliberately what it does not:
 *
 *   classes   every class name the instance's stylesheet defines a rule for
 *   tokens    every `--ap-*` custom property and its computed value
 *   recipes   the full class string of each design-system component this page renders
 *   icons     the path data of each icon this page renders
 *
 * It does NOT copy the stylesheet. The class *names* are what build-time validation needs,
 * they are ~100x smaller than the sheet, and they are derived data rather than a copy of it.
 *
 * Everything here comes from the page the operator is already authenticated to see. Run it on
 * several different pages and merge: a page can only report the components it renders, so one
 * page is always a partial picture.
 */
(() => {
    /** Class names any rule in any readable sheet defines. Tailwind escapes `:` `/` `[` etc.
     *  inside the class name, so the backslashes have to come back out. */
    function definedClasses() {
        const found = new Set();
        const walk = (rules) => {
            for (const rule of rules) {
                if (rule.selectorText) {
                    for (const m of rule.selectorText.matchAll(/\.((?:[\w-]|\\.)+)/g)) {
                        found.add(m[1].replace(/\\(.)/g, '$1'));
                    }
                }
                if (rule.cssRules) walk(rule.cssRules);
            }
        };
        for (const sheet of document.styleSheets) {
            try { walk(sheet.cssRules); } catch { /* cross-origin sheets throw */ }
        }
        return [...found].sort();
    }

    /** Every `--ap-*` custom property, with the value it resolves to on :root. */
    function tokens() {
        const names = new Set();
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (!rule.style) continue;
                    for (const name of rule.style) if (name.startsWith('--ap-')) names.add(name);
                }
            } catch { /* cross-origin */ }
        }
        const root = getComputedStyle(document.documentElement);
        const out = {};
        for (const name of [...names].sort()) out[name] = root.getPropertyValue(name).trim();
        return out;
    }

    /**
     * The design system marks its own components with `data-slot` attributes and `group/<name>`
     * scope classes. Both exist only because a component declared them, which makes them a far
     * more reliable key than a guessed CSS selector — and the sweep reports what the page
     * actually renders instead of what you remembered to look for.
     */
    function recipes() {
        const out = {};
        const record = (key, el) => {
            if (out[key]) return;                       // first instance on the page wins
            const cs = getComputedStyle(el);
            out[key] = {
                tag: el.tagName.toLowerCase(),
                classes: (el.getAttribute('class') ?? '').trim(),
                role: el.getAttribute('role') ?? null,
                parentSlot: el.parentElement?.getAttribute('data-slot') ?? null,
                computed: {
                    height: cs.height,
                    paddingLeft: cs.paddingLeft,
                    borderTopWidth: cs.borderTopWidth,
                    borderRadius: cs.borderRadius,
                    backgroundColor: cs.backgroundColor,
                    color: cs.color,
                    fontSize: cs.fontSize,
                    fontWeight: cs.fontWeight,
                    lineHeight: cs.lineHeight,
                },
            };
        };
        for (const el of document.querySelectorAll('[data-slot]')) {
            record(`slot:${el.getAttribute('data-slot')}`, el);
        }
        for (const el of document.querySelectorAll('*')) {
            for (const c of el.classList) if (c.startsWith('group/')) record(c, el);
        }
        return out;
    }

    /**
     * Icon path data, from the SVGs the page renders.
     *
     * `@core/icons` is not importable, and substituting an emoji or a `▾` fails silently: it
     * ignores `currentColor` and renders in whatever font the browser picked. Harvesting the
     * real path is the only faithful option.
     *
     * Names are a best effort — the platform does not put the icon's name in the DOM — so each
     * entry carries the hints that were available and the path is keyed by its own hash.
     */
    function icons() {
        const out = {};
        for (const svg of document.querySelectorAll('svg')) {
            const box = svg.getAttribute('viewBox');
            if (!box) continue;
            const paths = [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')).filter(Boolean);
            if (paths.length === 0) continue;
            const d = paths.join(' ');
            let hash = 0;
            for (let i = 0; i < d.length; i += 1) hash = ((hash << 5) - hash + d.charCodeAt(i)) | 0;
            const key = `icon_${(hash >>> 0).toString(36)}`;
            if (out[key]) continue;
            const owner = svg.closest('[aria-label],button,a');
            out[key] = {
                viewBox: box,
                path: d,
                sizeClass: (svg.getAttribute('class') ?? '').trim() || null,
                hint: owner?.getAttribute('aria-label') ?? owner?.textContent?.trim().slice(0, 40) ?? null,
            };
        }
        return out;
    }

    return {
        capturedAt: new Date().toISOString(),
        url: location.pathname,
        classes: definedClasses(),
        tokens: tokens(),
        recipes: recipes(),
        icons: icons(),
    };
})();
