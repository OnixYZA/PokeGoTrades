import { describe, expect, it } from 'vitest';

import {
  SPECIAL_BACKGROUND_LABEL,
  attributeBadges,
  backgroundBadgeLabel,
  hasSpecialBackground,
  listingBackgroundFromToggle,
} from './listing-attributes';

describe('listing background helpers', () => {
  it('maps a Shiny listing with specialBackground=false to meta and hides any background badge', () => {
    const bg = listingBackgroundFromToggle(false);
    expect(bg).toBe('meta');
    expect(hasSpecialBackground(bg)).toBe(false);
    expect(backgroundBadgeLabel(bg)).toBeNull();

    const badges = attributeBadges({
      purified: false,
      costume: false,
      sizeClass: undefined,
      tags: ['Raid Exclusive'],
    });
    const labels = badges.map((b) => b.label);
    expect(labels).toEqual(['Raid Exclusive']);
    expect(labels).not.toContain('Community Day');
    expect(labels).not.toContain(SPECIAL_BACKGROUND_LABEL);
  });

  it('includes Community Day in attributeBadges only when explicitly in tags', () => {
    const withoutTag = attributeBadges({
      purified: false,
      costume: false,
      sizeClass: null,
      tags: ['Legacy Move'],
    });
    expect(withoutTag.map((b) => b.label)).not.toContain('Community Day');

    const withTag = attributeBadges({
      purified: false,
      costume: false,
      sizeClass: null,
      tags: ['Community Day', 'Raid Exclusive'],
    });
    expect(withTag).toEqual([
      { key: 'tag:Community Day', label: 'Community Day' },
      { key: 'tag:Raid Exclusive', label: 'Raid Exclusive' },
    ]);
  });

  it('maps specialBackground=true to legacy and renders Special Background label', () => {
    const bg = listingBackgroundFromToggle(true);
    expect(bg).toBe('legacy');
    expect(hasSpecialBackground(bg)).toBe(true);
    expect(SPECIAL_BACKGROUND_LABEL).toBe('Special Background');
    expect(backgroundBadgeLabel(bg)).toBe('Special Background');
  });

  it('treats legacy/existing DB bg rows (meta, shiny, shadow) as having no special background badge', () => {
    for (const bg of ['meta', 'shiny', 'shadow'] as const) {
      expect(hasSpecialBackground(bg)).toBe(false);
      expect(backgroundBadgeLabel(bg)).toBeNull();
    }
  });

  it('preserves Purified, Costume, sizeClass, and tag order/keys in attributeBadges', () => {
    const badges = attributeBadges({
      purified: true,
      costume: true,
      sizeClass: 'XXL',
      tags: ['Level 1', 'Hundo IV'],
    });
    expect(badges).toEqual([
      { key: 'purified', label: 'Purified' },
      { key: 'costume', label: 'Costume' },
      { key: 'size', label: 'XXL' },
      { key: 'tag:Level 1', label: 'Level 1' },
      { key: 'tag:Hundo IV', label: 'Hundo IV' },
    ]);
  });
});
