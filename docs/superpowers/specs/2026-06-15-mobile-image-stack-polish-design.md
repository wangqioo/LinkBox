# Mobile Image Stack Polish Design

## Context

The mobile feed already groups same-batch image uploads into one swipeable card. User testing confirmed the grouping works, but the visual stack does not read strongly enough as a batch of photos.

## Chosen Direction

Use the "photo deck" direction from the visual companion. The gallery should look like a small pile of real photos:

- Back photos visibly peek from the upper-left side of the active photo.
- The active photo remains the clear focus and keeps tap-to-open behavior.
- The counter and delete-current-image affordance stay visible on the active photo.
- The card should still fit the existing right-aligned feed bubble layout without horizontal page overflow.

## Alternatives Rejected

- Carousel side cards: clearer swipe hint, but less like a stacked batch.
- Main image with filmstrip: clearest inventory view, but too tall and less aligned with the requested "stacked together" feel.

## Implementation Scope

Only polish `mobile/src/components/ImageBatchCard.vue`. Do not change backend batching, upload metadata, grouping logic, or feed ordering.

## Verification

- Mobile build passes.
- Existing image batch grouping tests still pass.
- Public mobile page remains reachable after deployment.
