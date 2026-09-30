# Security for the private Workers branch

This branch has no application login or rate limiting. Cloudflare Access is its access-control boundary. Before attaching any public route, protect the entire Worker—including production domains and preview/version URLs—with an All traffic policy restricted to the intended operator. All identities allowed through that policy can read and modify all app data. Keep the R2 receipt bucket private.

Do not put OpenAI keys in source or Wrangler variables; use a Worker secret and `.dev.vars` locally. Keep D1/R2 backups separately. Input validation, same-origin write checks, and financial D1 batch guards should not be removed just because the app is private.

To report an issue with this fork, contact its maintainer privately. For vulnerabilities in upstream ShareTab, follow the [upstream security policy](https://github.com/sw-carlos-cristobal/sharetab/security/policy). Do not post sensitive exploit details in a public issue.
