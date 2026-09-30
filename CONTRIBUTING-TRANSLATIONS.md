# Translations

ShareTab supports two languages: English (`en`) and Vietnamese (`vi`). English in `messages/en/` is the source. `messages/vi/` must keep the same keys.

```bash
pnpm run lint:i18n
```

Keep ICU placeholders such as `{name}` and `{count, plural, ...}` unchanged. Do not translate the ShareTab name.
