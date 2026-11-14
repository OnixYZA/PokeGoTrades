import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

import { ALL_LOCATIONS } from '../../constants/locations';
import { buildLocationOrClause } from './listings';

describe('buildLocationOrClause', () => {
  it('returns null for All locations', () => {
    expect(buildLocationOrClause(ALL_LOCATIONS)).toBeNull();
    expect(buildLocationOrClause('  all locations  ')).toBeNull();
  });

  it('builds city-wide predicates for a single-segment city', () => {
    expect(buildLocationOrClause('Bengaluru')).toBe('loc_key.eq."bengaluru",loc_key.like."%, bengaluru"');
    expect(buildLocationOrClause('Bangalore')).toBe('loc_key.eq."bengaluru",loc_key.like."%, bengaluru"');
  });

  it('builds neighbourhood + city predicates for Neighbourhood, City labels', () => {
    const clause = buildLocationOrClause('Indiranagar, Bengaluru');
    expect(clause).toBe(
      'loc_key.eq."indiranagar",loc_key.eq."indiranagar, bengaluru",loc_key.eq."bengaluru",loc_key.like."%, bengaluru"',
    );
    expect(buildLocationOrClause('Indiranagar, Bangalore')).toBe(clause);
  });

  it('deduplicates predicates when neighbourhood equals city', () => {
    expect(buildLocationOrClause('Bengaluru, Bengaluru')).toBe(
      'loc_key.eq."bengaluru",loc_key.eq."bengaluru, bengaluru",loc_key.like."%, bengaluru"',
    );
  });

  it('escapes commas, parentheses, quotes, %, _, and \\ safely for LIKE and PostgREST', () => {
    const clause = buildLocationOrClause('Gate (A), "Test" 100%_\\City');
    expect(clause).not.toBeNull();
    expect(clause).toContain('loc_key.eq."gate (a)"');
    expect(clause).toContain('loc_key.eq."\\"test\\" 100%_\\\\city"');
    expect(clause).toContain('loc_key.like."%, \\"test\\" 100\\\\%\\\\_\\\\\\\\city"');
  });

  it('returns null for coordinate-like input', () => {
    expect(buildLocationOrClause('13.0012, 80.2565')).toBeNull();
  });
});
