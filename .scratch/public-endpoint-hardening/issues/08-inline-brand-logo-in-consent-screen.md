# 08: Inline Dark Brand Logo in Consent Screen

**What to build:** Inline the dark mode brand SVG directly into `renderConsentHtml` in `src/auth/provider.ts` to ensure zero external HTTP network requests during OAuth consent screen rendering.

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] `renderConsentHtml` renders the dark brand SVG inlined into the HTML template
- [x] No external asset HTTP request is needed to render the consent page logo
- [x] Visual fidelity of the OAuth consent page is fully preserved
- [x] OAuth consent page tests verify inlined SVG rendering
