#!/usr/bin/env node
/**
 * Fail the build on a class or token the instance does not define.
 *
 *   node check.mjs --generated typescript/src/generated/design-system.ts typescript/src
 *
 * Both failures are otherwise completely silent. A Tailwind class the platform's build never
 * generated matches no rule, so the element renders unstyled with no error. A mistyped
 * `--ap-*` token resolves to the empty string and `var()` falls back. TypeScript validates
 * neither, and no unit test can see either — jsdom has no platform CSS.
 *
 * Exit 0 clean, 1 on findings, 2 on a usage or read error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

function parseArgs(argv) {
    const args = { roots: [], generated: 'typescript/src/generated/design-system.ts', ignore: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--generated') { args.generated = argv[++i]; continue; }
        if (a === '--ignore') { args.ignore.push(argv[++i]); continue; }
        if (a === '--help' || a === '-h') { args.help = true; continue; }
        args.roots.push(a);
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.roots.length === 0) {
    console.error(`usage: node check.mjs [--generated <file>] [--ignore <name>]... <dir>...

Diffs class names and --ap-* tokens used in the source tree against those the instance
actually defines, per the harvested module. --ignore may be repeated for known exceptions.`);
    process.exit(args.help ? 0 : 2);
}

let generated;
try {
    generated = readFileSync(args.generated, 'utf8');
} catch (error) {
    console.error(`error: could not read ${args.generated}: ${error.message}`);
    console.error('       run write.mjs first to harvest it from the instance.');
    process.exit(2);
}

const classesMatch = generated.match(/export const CLASSES[^=]*=\s*new Set\((\[[\s\S]*?\])\);/);
const tokensMatch = generated.match(/export const TOKENS[^=]*=\s*(\{[\s\S]*?\n\});/);
if (!classesMatch || !tokensMatch) {
    console.error(`error: ${args.generated} is not in the expected shape; regenerate it.`);
    process.exit(2);
}
const defined = new Set(JSON.parse(classesMatch[1]));
const definedTokens = new Set(Object.keys(JSON.parse(tokensMatch[1])));
const ignore = new Set(args.ignore);

/** Source files worth scanning. */
function walk(dir, acc = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'generated' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, acc);
        // Test files are skipped: they are full of hyphenated fixture strings ("high-priority",
        // "signed-in") and almost never carry class lists.
        else if (/\.(test|spec)\./.test(entry)) continue;
        else if (['.ts', '.tsx', '.css', '.js', '.jsx'].includes(extname(entry))) acc.push(full);
    }
    return acc;
}

/**
 * Candidate class names in a source file.
 *
 * Only tokens that *look* like utilities are considered: a bare word is far more likely to be
 * prose, an AQL fragment or an identifier than a class, so a candidate must contain a hyphen,
 * a colon or a slash. That keeps the check quiet enough to leave switched on, at the cost of
 * missing single-word classes like `flex` — which, being single words, are also the ones the
 * build is overwhelmingly likely to have generated.
 *
 * Two exclusions earn their place, both found by running this against a real tree:
 *
 *   SVG path data. A glyph like `M450-450H220v-60h230Z` is hyphen-rich and splits into dozens
 *   of plausible-looking "classes". Any icon module would bury the real findings.
 *
 *   Classes the project defines itself. Custom UI ships its own CSS through `adoptCss`, and
 *   those class names are legitimately absent from the platform's sheet.
 */
const CANDIDATE = /^[a-z@*[-][a-z0-9:/\[\]&_.,%!#()@*-]*$/i;
const LOOKS_LIKE_UTILITY = /[-:/]/;

/** Strip comments. Prose about classes ("the `field-hover:` variant", "Home/End move") is by
 *  far the largest source of false positives, and none of it reaches the browser. */
function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))   // keep line numbers
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));
}

/** Path data is numerically dense and class strings are not; the commands clinch it. */
function looksLikePathData(literal) {
    const digits = (literal.match(/\d/g) ?? []).length;
    if (digits / literal.length > 0.25) return true;
    return /[MmLlHhVvCcSsQqTtAaZz]\s*-?\d/.test(literal);
}

/** Class names the project defines in its own CSS (template literals passed to adoptCss). */
function selfDefinedClasses(files) {
    const own = new Set();
    for (const file of files) {
        for (const m of readFileSync(file, 'utf8').matchAll(/\.([a-z][\w-]*)\s*(?:[,{:[]|$)/gim)) {
            own.add(m[1]);
        }
    }
    return own;
}

const allFiles = args.roots.flatMap((root) => walk(root));
const ownClasses = selfDefinedClasses(allFiles);

const findings = [];
for (const root of args.roots) {
    for (const file of walk(root)) {
        const lines = stripComments(readFileSync(file, 'utf8')).split('\n');

        lines.forEach((line, i) => {
            // Module specifiers are not class lists.
            if (/^\s*(import|export)\b.*\bfrom\b/.test(line) || /^\s*import\s/.test(line)) return;
            // class candidates, from string literals only
            for (const m of line.matchAll(/'([^'\n]{2,400})'|"([^"\n]{2,400})"|`([^`\n]{2,400})`/g)) {
                const literal = m[1] ?? m[2] ?? m[3];
                if (literal.includes('://') || literal.startsWith('/')) continue;   // urls, paths
                if (looksLikePathData(literal)) continue;                           // svg glyphs

                // Trailing sentence punctuation survives the split in prose like
                // "…its own bg-surface-default." and would otherwise read as an unknown class.
                const words = literal.split(/\s+/).map((w) => w.replace(/[.,;:]+$/, '')).filter(Boolean);
                if (words.length === 0) continue;

                // Every word in a class list is class-shaped. One that is not means this is
                // prose, a selector, a URL or a message — not a list of classes.
                if (!words.every((w) => CANDIDATE.test(w))) continue;

                // And a real class list names at least one class the instance defines. This is
                // what makes the check quiet enough to leave on: a string of invented-looking
                // words with no anchor in the stylesheet is almost never a class list.
                const anchored = words.some((w) => defined.has(w) || ownClasses.has(w));
                if (!anchored) continue;

                for (const word of words) {
                    if (ignore.has(word)) continue;
                    if (!LOOKS_LIKE_UTILITY.test(word)) continue;
                    if (word.startsWith('--') || word.startsWith('data-') || word.startsWith('aria-')) continue;
                    if (word.startsWith('group/')) continue;        // scope markers define no rule
                    if (defined.has(word) || ownClasses.has(word)) continue;
                    findings.push({ file, line: i + 1, kind: 'class', name: word });
                }
            }
            // token references, unambiguous
            for (const m of line.matchAll(/--ap-(?:comp|sem)-[a-z0-9-]+/g)) {
                const name = m[0];
                // A trailing hyphen means prose naming a family (`--ap-comp-switch-*`), not a
                // reference. Comments in this codebase do that constantly.
                if (name.endsWith('-')) continue;
                if (ignore.has(name) || definedTokens.has(name)) continue;
                findings.push({ file, line: i + 1, kind: 'token', name });
            }
        });
    }
}

if (findings.length === 0) {
    console.log(`design-system check: clean (${defined.size} classes, ${definedTokens.size} tokens defined)`);
    process.exit(0);
}

const byName = new Map();
for (const f of findings) {
    if (!byName.has(f.name)) byName.set(f.name, { kind: f.kind, sites: [] });
    byName.get(f.name).sites.push(`${relative(process.cwd(), f.file)}:${f.line}`);
}

console.error(`design-system check: ${byName.size} undefined name(s)\n`);
for (const [name, { kind, sites }] of [...byName].sort()) {
    console.error(`  ${kind === 'token' ? 'token' : 'class'}  ${name}`);
    for (const site of sites.slice(0, 3)) console.error(`         ${site}`);
    if (sites.length > 3) console.error(`         … and ${sites.length - 3} more`);
}
console.error(`\nA class the platform's build never generated matches no rule; a token that is not
defined resolves to empty and var() falls back. Both render without erroring.
Write these as real CSS you adopt, or use a name the instance defines.
Known-good exceptions: --ignore <name>.`);
process.exit(1);
