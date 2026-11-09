<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- DBS Control OS PDFs use one browser-side renderer from the current hydrated ERP_STATE; individual and ZIP exports await the same renderer to avoid competing exports and incomplete image loading.
- PDF libraries and Unicode fonts are served locally; document styles are centralized in the renderer so exports remain independent of CDN availability and UI styling.
- Server modules that query tables absent from the connected Cloud schema use a loosely typed `supabaseAdmin` alias (`SupabaseClient<any>`); why: auto-saves regenerate `types.ts` from that backend and would otherwise break the build. Query `error` results must still be checked explicitly.
- DBS Control OS viewing uses `public/dbs-control-os-viewer.js` (read-only over hydrated ERP_STATE; actions delegate to existing page functions); why: opening an OS must not force a PDF download nor duplicate save logic.


## Canonical Supabase production target — mandatory
- The ONLY canonical Supabase project for this repository is `gdglototcrehvhkvcqsq` (`https://gdglototcrehvhkvcqsq.supabase.co`). Never change application configuration, generated types, migrations, or CLI targeting to `vtwzsuwxjrryagpjfmty`.
- `src/integrations/supabase/project-config.ts`, tracked `.env`, and `supabase/config.toml` must remain pinned to the official ref. If Lovable Cloud injects a different project ref, treat it as an external preview environment only; do not copy its env values into the repository.
- Regenerate `src/integrations/supabase/types.ts` ONLY against project ref `gdglototcrehvhkvcqsq`. Never use schema/type output from Lovable Cloud's managed project.
- Before any schema change, compare the migration against the official project's migration history and live catalog. Apply additive, idempotent migrations only; never DROP, TRUNCATE, or DELETE production records. Do not alter existing RLS policies or grants without verifying the exact authorization model.
- Keep the existing read-only DBS Control OS viewer and all frontend improvements; backend configuration fixes must not remove or rewrite UI features.
