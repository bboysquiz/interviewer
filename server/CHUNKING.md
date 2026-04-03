# Note Chunking

This document describes how note text is split into chunks for search and future interview-mode retrieval.

## Goals

- keep chunking simple and deterministic
- preserve chunk order
- work well for technical notes with paragraphs, lists, and short code snippets
- stay compatible with future embeddings

## Strategy

- Input comes from note `raw_text`.
- Text is normalized softly:
  - line endings are converted to `\n`
  - trailing spaces before line breaks are removed
  - long runs of empty lines are collapsed
- The chunker tries to split at natural boundaries in this order:
  1. double line break
  2. single line break
  3. whitespace
- Chunk size targets for technical notes:
  - target: about `900` characters
  - minimum useful size: about `280` characters
  - hard maximum: about `1100` characters

This keeps a chunk large enough for context, but still compact enough for lexical search and later LLM retrieval.

## Stored fields

Each row in `note_chunks` stores:

- `chunk_index`: stable order inside the source note
- `content`: chunk text close to the original note formatting
- `search_text`: whitespace-normalized text for FTS
- `start_offset`
- `end_offset`

`content` is better for display and future AI context. `search_text` is better for FTS and later hybrid search.

## Future embeddings

The current design stays ready for embeddings because:

- chunks have stable `id`
- order is explicit via `chunk_index`
- embeddings metadata already exists in `note_chunks`
- chunk sizes are already close to what is practical for semantic retrieval
