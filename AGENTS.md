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
