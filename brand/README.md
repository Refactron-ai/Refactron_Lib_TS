# Tabslot

The Refactron mascot. A die cut block with a tab on its crown and a socket at its base, printed in one colour at two values.

```
        ▄▄
    ▄▄▄▄██▄▄▄▄
   ██▀██████▀██
   ██▄██████▄██
   ▀██████████▀
   ████████████
    ▀▀▀▀▀▀▀▀▀▀
```

## The rule

**Tabslot does not explain the product.** It is not a diagram of the verification pipeline, it is not a gate, and the tab is not a metaphor for a diff fitting into a codebase. It is a shape that joins to other shapes, and the joint is the only interesting thing about it.

This is the one thing that must not be relaxed. A mascot that argues for the product closes the question of what it is, and a closed question is a forgotten mascot. Nobody agrees what Clawd is, and the disagreement is why people draw it. Do not write a paragraph explaining what the tab represents. Let people decide it is a Lego brick, a puzzle piece, a tooth, or a stamp.

Readings collected so far, all of them fine: a die cut sticker, a keystone, a Scrabble tile, a tooth, a plug, and a face.

**A face is the most common reading, and it was not designed in.** At any real size the grip cuts read as eyes and the socket tongue reads as a nose. That was noticed after the sprite was chosen rather than before, and it is being left alone, because the whole point of this section is that a mascot people can argue about survives and one that means a single thing does not. Do not try to talk anyone out of it.

## Why it has states, when Cobble does not

Spolia's mascot carries a hard rule that Tabslot appears to break: **the character never signals a verdict.** That rule exists because a mascot which turns green on success and red on failure is a status indicator wearing a face, and it will eventually be read as the verdict itself rather than as company beside it.

Tabslot keeps the reason and changes the mechanism. **The states are form, never colour.** All three are the same two values of the same cream in every theme, and the palette below is identical across `safe`, `unsafe` and `unproven`. What changes is the silhouette: whole, sheared, or half printed. Colour still belongs to the text.

That distinction is enforced rather than trusted. `generate.mjs` refuses to build if any state alters the socket, and the palette has no third entry for a state to reach for.

If a future change proposes a green Tabslot, the answer is no, and this section is why.

## Do not redesign it

The sprite in `tabslot-sprites.json` is the one that was chosen, as drawn, out of thirty candidates across five rounds.

Tessel, the runner up, is the reason the generator exists. Its write up claimed the two halves interlocked and they did not: it had a notch on one side and no tab to meet it, and the claim went unchallenged because prose was the only thing asserting it. Every geometric claim in this file is now a check in `generate.mjs` instead.

Three specific refusals:

- **Do not draw the face in.** People already see one, and that is fine. Cutting actual eyes, a pupil or a mouth is not: it turns a mark that reads as a face into a character that is one, and then UNSAFE stops being mechanical damage and starts being an injury.
- **Do not taper the socket.** Its outline is the body's shoulder mirrored, ten wide then twelve, read upward. That is what makes the two bands look like parts that fit rather than an object sitting on a slab.
- **Do not close the gap in UNSAFE.** The fragments leave a hole as wide as the tab that used to fill it, and they stand one row shorter. Pull them together and it reads as a smaller tab rather than a snapped one.

## Files

| File                                                       | What it is                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tabslot-sprites.json`                                     | **The source of truth.** Three states, the palette, the two grounds, the region map.    |
| `generate.mjs`                                             | Validates the JSON, then writes every other file in this directory.                     |
| `png.mjs`                                                  | A minimal RGBA PNG encoder, so rasters are painted from the grid rather than resampled. |
| `tabslot-cream.svg`, `tabslot-ink.svg`                     | SAFE. 14x14, run length encoded, `shape-rendering="crispEdges"`.                        |
| `tabslot-sheared-*.svg`                                    | UNSAFE.                                                                                 |
| `tabslot-unprinted-*.svg`                                  | UNPROVEN.                                                                               |
| `tabslot-{state}-{tone}-{size}.png`                        | Transparent marks. SAFE at 1024 down to 32, the other two down to 256.                  |
| `tabslot-cream-on-ink-*.png`, `tabslot-ink-on-cream-*.png` | Opaque avatars, SAFE only, 1024 / 512 / 400.                                            |
| `tabslot-terminal.json`                                    | The half block art as `{tone, text}` runs. **This is what the CLI consumes.**           |
| `tabslot.txt`                                              | The same art in plain text, seven rows per state. Lossy, see below.                     |

Everything except the two scripts and the JSON is generated. Edit a sprite, run `node brand/generate.mjs`, commit what changes.

**Naming.** A suffix always names the colour of the asset's own ink, never the ground it goes on: `tabslot-cream.svg` is inked in cream and therefore belongs on ink. Where a file has a ground of its own, the name says so in full, as in `tabslot-cream-on-ink-1024.png`.

`docs/logo` uses the opposite convention, where `refactron-symbol-light.svg` names the light coloured asset that goes on the dark ground. That is broken with here on purpose. It reads backwards, and once a directory holds both transparent marks and opaque avatars, a suffix meaning the ink on half the files and the ground on the other half is unusable.

## Rasters

Painted straight from the sprite grid by `png.mjs`, never rasterised from the SVG, and only ever at a whole number scale. A 14 pixel sprite put through a general purpose rasteriser comes back soft at any fractional scale, and the socket's 42 percent alpha makes that easy to miss.

Each canvas uses the largest whole multiple of 14 that leaves the wanted margin, so coverage lands near the target rather than exactly on it. Marks sit at 82 to 88 percent, avatars at 70 to 71, because every platform crops an avatar to a circle or a rounded square.

| Kind    | Ground      | Alpha                                                                                                          |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| marks   | transparent | the socket keeps its 42 percent, so it composites correctly on any page                                        |
| avatars | opaque      | the socket is flattened at encode time, so no platform gets to flatten it against a colour of its own choosing |

The two agree by construction: the avatar's flattened socket comes out `#6E6D6A`, which is the value `tabslot-sprites.json` declares for the ink ground.

No favicon exists for UNSAFE or UNPROVEN. Nothing should be making a favicon out of a failure state, so the ladder for those two stops at 256.

## Palette

One hue, two values, which is the system the mark already uses. `docs/logo/refactron-symbol-light.svg` is a solid rounded square plus the same cream at `opacity="0.42"` behind it. Tabslot is that pair applied to a sprite.

| Code | Role   | Alpha | On ink `#141416` | On cream `#E9E6DF` |
| ---- | ------ | ----- | ---------------- | ------------------ |
| `B`  | body   | 1.0   | `#E9E6DF`        | `#141416`          |
| `G`  | socket | 0.42  | `#6D6C6A`        | `#908E8B`          |

The SVGs carry the alpha and composite themselves. The terminal cannot, so `tabslot-sprites.json` also declares the flattened hex for each ground, and `generate.mjs` recomputes both from the alpha and throws if they have drifted. That check is the only thing keeping the two surfaces the same colour.

**Why not more colours.** Refactron's whole identity is that it is monochrome and does not decorate. Cobble gets four hues because Spolia is a separate product that must not wear the parent's greys; Tabslot is the parent, so it wears them.

**There is now one cream, and it is `#E9E6DF`.** Tabslot was drawn on `#EAE7DE`, taken from `docs.json` on the reasoning that it was the machine readable file. That was the wrong tiebreak: `docs/logo/*.svg` and the website's `--color-cream` were both already on `#E9E6DF`, and two hand maintained surfaces outvote one config key. `docs.json` moved to match rather than the other way round, and this sprite moved with it.

The two flat hexes above are the recomputed ones. Nothing had to be redrawn: the value changed in `tabslot-sprites.json`, the validator refused the stale flats by name, and a regeneration produced the rest.

## States

| State      | Form         | Reading                                                                                                                                                                                   |
| ---------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safe`     | whole        | Whole and **seated**: the socket tongue sits inside the slot. Nothing is added to signal good news. The absence of damage is the signal, which is why it never looks pleased with itself. |
| `unsafe`   | sheared      | The crown tab has snapped into two fragments. **The thing that joins is the thing that fails.** It stays seated, so the break reads as damage rather than as collapse.                    |
| `unproven` | half printed | The ink runs out before the base, so it **never reaches the socket**. Nothing is broken and nothing is engaged. **Blank, not broken.**                                                    |

`unproven` is the state that matters most and the one easiest to get wrong. Refactron's honest degradation is worth nothing if the mascot for it looks like failure, so it must never borrow anything from `unsafe`: no fragments, no cracks, no missing crown. It is an unfinished print of the same healthy object.

## Terminal

Each 14 row sprite collapses to seven text rows using `▀▄█`. Where the two halves of a cell disagree on tone, **the lower half wins**, so socket ink emerging under the body reads as socket.

`tabslot-terminal.json` keeps the tone per run because a two colour mascot printed in one colour is not the mascot. The CLI must render each run as its own segment, not join the row into a single string.

`tabslot.txt` is the flattened version, for a README or a pipe with no colour. It is lossy by design: the socket and the body become the same glyph, and SAFE and UNSAFE then differ only at the crown. Use it where colour is genuinely unavailable, not as a shortcut.

**Respect `prefers-reduced-motion`,** and note there is nothing to respect yet: Tabslot has no animation. If poses are ever added, they go in the JSON as a fourth key and every one of them regenerates from the same validator.

## Usage constraints

1. **Tabslot never changes colour with the verdict.** See the section above. Status colour is carried by the text.
2. **Tabslot never celebrates.** No confetti, no motion on a SAFE. Refactron's credibility is that it does not oversell what it measured, and a pleased mascot beside "4 of 5 changed statements covered" undercuts the caveat underneath it.
3. **Tabslot never appears without the verdict word.** The shape is not the report. If it is on screen, `SAFE`, `UNSAFE` or `UNPROVEN` is on screen with it, spelled out.
4. **Do not put Tabslot in the report JSON.** `VerdictReport` is a public contract consumed by CI. Decoration does not go in it.

## Relationship to the mark, and to Cobble

The mark stays exactly as it is: two rounded squares, monochrome cream on ink, `docs/logo/`. Tabslot does not replace it and does not appear next to it.

Cobble is Spolia's, and the two are deliberately unlike: Cobble is stacked squares with a face and four weathered hues, Tabslot is one die cut block with no face and one hue. The shared DNA is the primitive, a square grid, which is enough family resemblance without inheriting anything. Same house, different door.

## Regenerating

```bash
node brand/generate.mjs
```

The validator runs first and throws rather than writing a crooked asset. It checks that

- every state is 14 rows of 14 characters and uses only codes the palette declares;
- both flattened hexes really are the ink composited over the ground at the declared alpha;
- the socket is byte identical in all three states;
- `safe` and `unsafe` are seated and `unproven` is not;
- the crown is one piece in `safe` and `unproven`, exactly two in `unsafe`, and `unproven` keeps the `safe` crown;
- the `unsafe` fragments leave a gap at least as wide as the tab and stand fewer rows tall;
- the socket outline mirrors the body's shoulder row for row.

Checks are ordered per state before cross state, so a broken tab is reported as a broken tab rather than as a mismatch with its neighbour.

A check that cannot fail is worse than no check, because it reads as coverage. The spread of the `unsafe` fragments was measured that way at first and dropped: two pieces always need a gap, so they always span at least three columns, and the assertion could never have gone red. The gap is measured instead, which can.

## Status

The assets here are final. **The CLI has not been switched over yet.** `src/cli/components/Mascot.tsx` still draws the previous Clawd shaped creature, and `src/ui/theme.ts` still carries `mascot: '#4a9eff'` and a `clawd_body` token. Wiring Tabslot in means the sprite, the two tone rendering, the verdict states, and retiring those tokens.

## Distribution

`package.json` ships a `files` whitelist of `dist/`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md` and `SECURITY.md`, so nothing in `brand/` reaches an npm tarball. When the CLI carries the mascot, the sprite it needs gets compiled into `dist/`, not shipped from here.
