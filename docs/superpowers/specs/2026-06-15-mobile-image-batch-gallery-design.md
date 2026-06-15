# Mobile Image Batch Gallery Design

## Goal

When a mobile user selects multiple images in one upload action, LinkBox should
preserve that upload as a durable image batch and show it as one stacked gallery
card in the mobile feed. The user can swipe horizontally inside the card to move
between images.

## Scope

- Applies to mobile image uploads where at least two selected files are images.
- Single image uploads keep the current single image card.
- Mixed uploads group only images from the same selection; non-image files stay
  as normal feed items.
- Existing per-image processing, AI description, download, detail page, and
  delete behavior remain per item.

## Data Model

Add nullable fields to `links`:

- `batch_id`: stable client-generated id for one multi-image upload action.
- `batch_index`: zero-based order inside that batch.

The backend accepts these fields only for mobile image uploads. Existing rows
without a batch stay unchanged.

## Mobile Feed Behavior

The mobile feed groups adjacent image items with the same `batch_id` into one
gallery card:

- The first visible slide is the lowest `batch_index`.
- The card shows a stacked visual treatment behind the active image.
- A counter such as `1 / 5` indicates position.
- Horizontal swipe changes the active image.
- Tapping opens the detail page for the active image.
- Deleting removes only the active image, not the whole batch.

## Error Handling

If one image in a batch fails to upload, already uploaded images remain in the
batch and the upload toast reports the failed file. If only one image in a batch
survives, the feed may render it as a normal image card.

## Testing

- Backend migration test covers adding `batch_id` and `batch_index`.
- Mobile API/upload logic test covers generating one batch id for multiple
  selected images and assigning stable indices.
- Mobile feed grouping test covers grouping same-batch images and leaving
  single images ungrouped.
- Mobile production build must pass.
