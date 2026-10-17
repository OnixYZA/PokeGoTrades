/**
 * Architecture guard: the four-point sparkle means "shiny" and nothing else.
 *
 * The shiny marker used to be re-drawn by hand at every call site (a "✦" text glyph here, lucide
 * `Sparkles` there), and the same shape then got reused for unrelated things: Purified, Custom Offer,
 * "No formal offer", Lucky, the "NEW" demand pill. A not-shiny listing looked shiny. The fix is
 * structural rather than a one-off icon swap: `components/ui/ShinyGlint.tsx` is the only module allowed
 * to draw the shape, and this test fails if anything else does, so the collision cannot come back
 * silently. Pure Node (fs + regex over source text); it imports nothing from react-native or lucide.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** Every directory that holds app source. Scripts, workers, supabase and e2e never render the badge. */
const SCAN_DIRS = ['app', 'components', 'constants', 'data', 'lib', 'store'];

/** The one module that may draw the sparkle (repo-relative, forward slashes). */
const SHINY_GLINT_MODULE = 'components/ui/ShinyGlint.tsx';

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
/** Tests may name the forbidden shapes (this one has to), so they are not scanned. */
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

interface Violation {
  file: string;
  line: number;
  reason: string;
  text: string;
}

const RULES: { reason: string; pattern: RegExp }[] = [
  {
    reason: 'sparkle glyph in text (U+2726 "✦", U+2727 "✧", U+2728 "✨")',
    pattern: /[✦✧✨]/,
  },
  {
    reason: 'escaped sparkle glyph (\\u2726, \\u2727, \\u2728)',
    pattern: /\\u\{?(?:2726|2727|2728)\}?/i,
  },
  {
    // Case-sensitive on purpose: it catches `Sparkles`, `Sparkle`, `SparklesIcon`, `LucideSparkles`,
    // `WandSparkles` and `Icons.Sparkles` in any import, re-export or lookup table, while leaving the
    // lowercase word in prose ("the lucky sparkle") alone.
    reason: 'lucide Sparkle/Sparkles icon (any alias)',
    pattern: /Sparkle/,
  },
  {
    reason: 'deep import of a lucide sparkle icon',
    pattern: /icons\/(?:wand-)?sparkles?\b/i,
  },
];

/** Pure so it can be exercised on synthetic source below as well as on the real tree. */
function findSparkleViolations(file: string, source: string): Violation[] {
  if (file === SHINY_GLINT_MODULE) return [];
  const violations: Violation[] = [];
  source.split('\n').forEach((text, index) => {
    for (const { reason, pattern } of RULES) {
      if (pattern.test(text)) violations.push({ file, line: index + 1, reason, text: text.trim() });
    }
  });
  return violations;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(full);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), out);
  return out.map((full) => path.relative(ROOT, full).split(path.sep).join('/'));
}

function explain(violations: Violation[]): string {
  return [
    '',
    'The four-point sparkle means "shiny" and nothing else.',
    `Only ${SHINY_GLINT_MODULE} may draw it: render <ShinyGlint /> for "shiny", and give every other meaning`,
    'its own icon (Purified = Droplet, Lucky = Clover, custom offer = MessageSquareText, ...). Do not import',
    'Sparkle/Sparkles (or any alias) from lucide-react-native, and do not write the glyphs "✦" "✧" "✨",',
    'not even in a comment (say "the shiny glint").',
    '',
    ...violations.map((v) => `  ${v.file}:${v.line}  ${v.reason}\n      ${v.text}`),
    '',
  ].join('\n');
}

describe('shiny glint guard', () => {
  it('draws the sparkle nowhere but ShinyGlint', () => {
    const violations = sourceFiles().flatMap((file) =>
      findSparkleViolations(file, readFileSync(path.join(ROOT, file), 'utf8')),
    );
    expect(violations, explain(violations)).toEqual([]);
  });

  it('scans the real tree, so a wrong path cannot make the guard vacuous', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    for (const known of ['components/ui/Sprite.tsx', 'components/ui/Chip.tsx', 'components/ui/DemandBadge.tsx', 'lib/format.ts']) {
      expect(files).toContain(known);
    }
    expect(files.some((f) => f.includes('node_modules') || TEST_FILE.test(f))).toBe(false);
  });

  it('keeps the exemption honest: ShinyGlint really is where the sparkle lives', () => {
    const source = readFileSync(path.join(ROOT, SHINY_GLINT_MODULE), 'utf8');
    expect(source).toMatch(/export function ShinyGlint\b/);
    expect(source).toContain('✦');
  });

  describe('findSparkleViolations', () => {
    const scan = (source: string, file = 'components/ui/Anything.tsx') => findSparkleViolations(file, source);

    it('flags a lucide sparkle import, whatever the alias', () => {
      expect(scan("import { Check, Sparkles } from 'lucide-react-native';")).toHaveLength(1);
      expect(scan("import { Sparkle as Spark } from 'lucide-react-native';")).toHaveLength(1);
      expect(scan("import { WandSparkles } from 'lucide-react-native';")).toHaveLength(1);
      expect(scan("import { SparklesIcon } from 'lucide-react-native';")).toHaveLength(1);
      expect(scan('const icon = Icons.Sparkles;')).toHaveLength(1);
      expect(scan("import Sparkles from 'lucide-react-native/dist/esm/icons/sparkles';").length).toBeGreaterThan(0);
    });

    it('flags the sparkle glyphs, literal or escaped, in code and in comments', () => {
      expect(scan('<Text>✦</Text>')).toHaveLength(1);
      expect(scan('<Text>✧ Lucky</Text>')).toHaveLength(1);
      expect(scan("const NEW_BADGE = '✨ New';")).toHaveLength(1);
      expect(scan("const glyph = '\\u2726';")).toHaveLength(1);
      expect(scan("const glyph = '\\u{2726}';")).toHaveLength(1);
      expect(scan('// the ✦ badge marks shiny')).toHaveLength(1);
    });

    it('reports the line of each hit', () => {
      const hits = scan("import { Check } from 'lucide-react-native';\n\n<Text>✦</Text>");
      expect(hits.map((h) => h.line)).toEqual([3]);
    });

    it('lets the icons that replaced the sparkle, plain prose and other stars through', () => {
      expect(scan("import { Clover, Droplet, MessageSquareText, Star } from 'lucide-react-native';")).toEqual([]);
      expect(scan('// the lucky sparkle used to be drawn here')).toEqual([]);
      expect(scan('4.9 ★ (128)')).toEqual([]);
    });

    it('exempts only the ShinyGlint module', () => {
      expect(scan('<Text>✦</Text>', SHINY_GLINT_MODULE)).toEqual([]);
      expect(scan('<Text>✦</Text>', 'components/ui/ShinyGlint.test.tsx')).toHaveLength(1);
      expect(scan('<Text>✦</Text>', 'components/ui/NotShinyGlint.tsx')).toHaveLength(1);
    });
  });
});
