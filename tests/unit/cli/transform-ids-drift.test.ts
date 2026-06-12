// Drift-detection for the transform-id catalog.
//
// Bug #4 (caught on Ansible, 2026-06-12): the CLI flag-parser's TRANSFORM_IDS
// was a hand-curated copy of the engine's TRANSFORM_ORDER and quietly fell 8
// transforms behind when the v0.2.3 catalog expansion landed. Net effect:
// `refactron run --transforms=all` silently dropped pep585_generics,
// pep604_optional_union, datetime_utc_alias, yield_from_for_loop,
// indexof_to_includes, object_assign_to_spread, string_concat_to_template_literal
// and vue_set_delete_to_assignment from every invocation.
//
// These assertions pin the three catalog sources to one truth so the next time
// a transform is added (or removed) the build screams instead of going quiet.
import { describe, it, expect } from 'vitest';
import { TRANSFORM_ORDER } from '../../../src/transform/engine.js';
import { TRANSFORM_IDS } from '../../../src/cli/run-command.js';

describe('transform-id catalog drift', () => {
  it('CLI TRANSFORM_IDS is the engine TRANSFORM_ORDER (identity, not a copy)', () => {
    // Same reference — the CLI exports the engine list verbatim. If a future
    // refactor turns this back into a hand-curated copy, this fails first.
    expect(TRANSFORM_IDS).toBe(TRANSFORM_ORDER);
  });

  it('TRANSFORM_ORDER covers every v0.2.3 transform with no duplicates', () => {
    expect(TRANSFORM_ORDER).toHaveLength(20);
    expect(new Set(TRANSFORM_ORDER).size).toBe(TRANSFORM_ORDER.length);
  });

  it('every v0.2.3 transform id is present (alphabetised reference set)', () => {
    // Pinned set, kept alphabetical so the diff on a new transform is one line.
    // Update this AND TRANSFORM_ORDER together; the identity check above will
    // catch any drift between TRANSFORM_ORDER and the CLI surface.
    const EXPECTED = [
      'callback_to_async_await',
      'class_to_dataclass',
      'commonjs_to_esm',
      'datetime_utc_alias',
      'deprecated_api_requests_to_httpx',
      'format_to_fstring',
      'implicit_any',
      'indexof_to_includes',
      'lru_cache_to_cache',
      'manual_typecheck_to_hints',
      'object_assign_to_spread',
      'pep585_generics',
      'pep604_optional_union',
      'promise_chains_to_async',
      'promise_constructor_to_async',
      'string_concat_to_template_literal',
      'super_no_args',
      'var_to_const_let',
      'vue_set_delete_to_assignment',
      'yield_from_for_loop',
    ];
    expect([...TRANSFORM_ORDER].sort()).toEqual(EXPECTED);
  });
});
