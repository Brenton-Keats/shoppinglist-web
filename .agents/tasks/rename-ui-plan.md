# Implementation Plan — Rename existing records (Product, List, Section, Store)

## Context & decisions (grounded in the worktree)

All paths are under `/Users/brenton.keats/Documents/repos/personal/shoppinglist-web/.worktrees/rename-ui`.

**Backend is done.** `src/lib/db/operations.ts` already exposes `updateProduct`,
`updateList`, `updateSection`, `updateStore`, each of which bumps `updated_at` and
records a `ChangeRecord` for sync. A rename is just `updateX(id, { name })`. No new
DB functions. No schema change. `ListItem.name_snapshot` stays FROZEN — do not
touch it, no cascade.

**What already exists (verified by reading the files):**

- `src/lib/components/SectionManager.svelte` and `src/lib/components/StoreManager.svelte`
  **already implement full inline rename**: a `Pencil` icon toggles the row into an
  `<input>` bound to `editName`, with `Check` (save) / `X` (cancel) buttons; `handleKeydown`
  maps Enter→save and Escape→cancel; `handleEditSave` does `editName.trim()`, rejects
  empty (`if (!name || !editingId) return;`), calls `updateSection`/`updateStore`, then
  `load()` to refresh reactively. Save/Cancel/Edit buttons carry `aria-label`s. These two
  satisfy all six requirements as-is. They are the canonical pattern to copy.
- **Products** are listed/edited on `src/routes/+page.svelte` via a bottom-sheet dialog
  (`editingProduct` + `saveProductEdit`). The sheet currently edits only section/store
  defaults and reorder — **it does not edit the product name**. The sheet title shows
  `editingProduct.name` as static text.
- **Lists** are listed on `src/routes/+page.svelte` via the "Lists" bottom-sheet
  (`showListSheet` + `allLists`). Each list is a `switchToList` button showing `list.name`.
  **There is no rename affordance for lists.** `updateList`, `createList` are already imported.

**UX pattern chosen (justified):** For Products and Lists, match the pattern already used
by SectionManager/StoreManager — a `Pencil` edit affordance that swaps the display into an
inline `<input>` with `Check`/`X` confirm/cancel, Enter-to-save, Escape-to-cancel. For the
Product sheet, the name input lives inside the existing sheet (the sheet is the established
"edit a product" surface); for Lists, use per-row inline editing inside the Lists sheet,
exactly like the manager components. This introduces no new dialog or pattern.

**Validation (all entities):** `name.trim()`; if empty/whitespace-only, keep the old name
and surface `toastStore.error(...)` (from `$lib/stores/toast.svelte`; `ToastHost` is already
mounted in `src/routes/+layout.svelte`, so toasts render app-wide). SectionManager/StoreManager
currently silently no-op on empty — for the NEW Product/List code, add the toast so the user
gets feedback; do not add any constraint beyond non-empty.

**Reactivity:** reuse the existing reload functions already in `+page.svelte`
(`loadProducts()`, `loadLists()`). When the renamed list is the active list, also update
`listStore.activeList` so any active-list name display updates (Svelte 5 runes store).

**Accessibility:** every new control gets an `aria-label` (e.g. `Rename {list.name}`,
`Save`, `Cancel`) and is a real `<button>`/`<input>`, keyboard-operable (Enter/Escape),
matching the existing manager components.

**No lint script exists** in `package.json` (scripts are `dev`, `build`, `preview`,
`prepare`, `check`, `check:watch`, `test`, `test:watch`). Verification uses
`npm run check`, `npm run test`, `npm run build`. Do not invent a lint step.

**Scope:** all edits are in `src/routes/+page.svelte`. SectionManager/StoreManager need
no code change (item 1 is a read-only confirmation). No new dependencies.

---

## Plan

- [x] 1. Confirm Section & Store rename already satisfy the requirements — no code change.
      Read `src/lib/components/SectionManager.svelte` and `src/lib/components/StoreManager.svelte`
      and verify each has: Pencil edit trigger, inline input bound to `editName`, Check/X
      save/cancel, `handleKeydown` Enter=save / Escape=cancel, `editName.trim()` with empty
      rejection, a call to `updateSection`/`updateStore`, a `load()` refresh, and aria-labels.
      If (and only if) any of the six requirements is genuinely missing, bring it to parity
      with the pattern; otherwise leave these files untouched.
      Files: (read-only) src/lib/components/SectionManager.svelte, src/lib/components/StoreManager.svelte
      Verify: `npm run check` passes (baseline, no changes expected here).

- [x] 2. Add product-name rename to the product edit sheet in `src/routes/+page.svelte`.
      Add a reactive `editName = $state('')` (set it in `openEditSheet(product)` to
      `product.name`, and it is implicitly reset next open). In the edit sheet markup
      (the `{#if editingProduct}` block), add a labelled text input above the Section field:
      `<label for="edit-name">Name</label>` + `<input id="edit-name" bind:value={editName} ...>`
      styled like the sibling inputs in that sheet. In `saveProductEdit`, before/with the
      existing `updateProduct` call, compute `const name = editName.trim();` and
      `if (!name) { toastStore.error('Name cannot be empty.'); return; }`; include `name` in
      the existing `updateProduct(editingProduct.id, { ... })` update object so one call
      persists name + the current section/store/sort changes. Do NOT touch `name_snapshot`
      or list-item names. Keep the existing `await loadProducts(); closeEditSheet();` so the
      catalog re-renders with the new name. The sheet already closes on Escape.
      Files: src/routes/+page.svelte
      Verify: `npm run check` passes; `npm run test` passes.

- [x] 3. Add inline list rename to the "Lists" bottom-sheet in `src/routes/+page.svelte`.
      Import `Pencil`, `Check`, `X` from `@lucide/svelte` (Pencil, X already imported; add
      Check). Add state `let editingListId = $state<string | null>(null)` and
      `let editListName = $state('')`. Add handlers mirroring SectionManager:
      `startEditList(list)` sets `editingListId`/`editListName`; `cancelEditList()` clears them;
      `handleListRenameSave()` does `const name = editListName.trim(); if (!name) { toastStore.error('Name cannot be empty.'); return; }`, then
      `await updateList(editingListId, { name });`, and if `editingListId === listStore.activeList?.id`
      set `listStore.activeList = { ...listStore.activeList, name }` for reactive active-list
      display, then `editingListId = null; await loadLists();`. Add a keydown handler on the
      input: Enter→save, Escape→`cancelEditList()`. In the `{#each allLists as list}` row markup,
      when `editingListId === list.id` render an `<input bind:value={editListName}>` with Check
      (aria-label "Save") and X (aria-label "Cancel") buttons; otherwise render the existing
      switch-to-list button plus a new Pencil button `aria-label={`Rename ${list.name}`}` that
      calls `startEditList(list)` and stops propagation so it does not trigger `switchToList`.
      Match the row styling/icons used in SectionManager so the look is consistent.
      Files: src/routes/+page.svelte
      Verify: `npm run check` passes; `npm run test` passes.

- [x] 4. Full verification of the rename feature.
      Run the project's real checks in order and confirm each is clean. Fix any type errors,
      Svelte warnings, or test failures introduced by items 2–3 before considering the task done.
      Files: (none — verification only)
      Verify: `npm run check` (svelte-check: 0 errors), then `npm run test` (vitest: all pass),
      then `npm run build` (vite build succeeds). All three must succeed.

---

## Verification results (iteration 1)

All edits are confined to `src/routes/+page.svelte` (`git diff --stat`: 1 file, +119/-21).
SectionManager.svelte and StoreManager.svelte were left untouched — item 1 was a
read-only confirmation and both already satisfy all six requirements (Pencil trigger,
inline `editName` input, Check/X, `handleKeydown` Enter=save/Escape=cancel,
`editName.trim()` + empty rejection, `updateSection`/`updateStore`, `load()` refresh,
aria-labels).

Commands run (in the worktree), exact output:

- `npm run check` → `svelte-check found 20 errors and 7 warnings in 6 files` (exit 1).
  These 20 errors / 7 warnings are **pre-existing and unrelated** to this feature.
  Proven by stashing the working changes and re-running on the clean base commit
  (`0bf8823`): the baseline reports the **identical** `20 errors and 7 warnings`.
  The flagged lines in `+page.svelte` are all pre-existing: unused `preferencesStore`
  (L7) and `sectionsArray` (L29), an `sectionOrder.get` arithmetic typing issue (L69),
  and the dialog-overlay a11y warnings on the two bottom sheets (role="dialog" div +
  backdrop onclick) that predate this change. My new code (Name input, list-rename
  input + Check/X/Pencil buttons) added **zero** new errors or warnings.
- `npm run test` → `Test Files 5 passed (5)`, `Tests 83 passed (83)` (exit 0).
- `npm run build` → `vite build` succeeded (exit 0).

Behavior verified by code-path inspection (no browser preview was run in this
environment):
- Product rename: `openEditSheet` seeds `editName = product.name`; the sheet renders a
  labelled `<input id="edit-name" bind:value={editName}>`; `saveProductEdit` computes
  `editName.trim()`, calls `toastStore.error('Name cannot be empty.')` and returns on
  empty, otherwise passes `name` into the single existing `updateProduct(id, {...})`
  call, then `loadProducts()` re-renders the catalog with the new name. Enter in the
  input saves; the sheet closes on Escape (existing overlay handler). `name_snapshot`
  is untouched — no cascade.
- List rename: inline per-row editing in the Lists sheet. Pencil
  (`aria-label="Rename {name}"`) calls `startEditList`; the row swaps to an
  `<input aria-label="List name" bind:value={editListName}>` with Check (aria-label
  "Save") and X (aria-label "Cancel"); `handleListRenameKeydown` maps Enter=save,
  Escape=cancel; `handleListRenameSave` trims, rejects empty with the same toast, calls
  `updateList(id, {name})`, updates `listStore.activeList` when the renamed list is
  active (reactive active-list display), then `loadLists()`. Closing the sheet clears
  edit state via `cancelEditList()`.

What was NOT verified at runtime: no browser/preview rendering was performed; the above
is static code-path verification plus the type/test/build gates.

## Notes / assumptions

- The task brief mentioned `npm run lint` as "likely" — it does not exist in this repo, so it
  is intentionally omitted. `npm run check` (svelte-check) is the type/lint gate here.
- Sections and Stores are already feature-complete for rename; item 1 is a guard against
  regressing that assumption, not new work.
- Reviewer stop contract is unchanged: this plan is implemented by the existing loop, which
  stops when `.agents/tasks/rename-ui-review.json` has `verdict` = `APPROVED`.
