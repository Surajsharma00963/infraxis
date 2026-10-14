# Infraxis Console

**Web Dashboard for Infraxis — Universal CI/CD & Software Infrastructure**

*Infrastructure for every release.*

Infraxis Console is the Next.js 16 frontend for the Infraxis platform, providing:
- Real-time build queue inspection and job details via WebSockets.
- Manual multi-platform build creation and field validation.
- Live streaming logs with monotonic ordering.
- Artifact downloads and integrity checksums.
- Multi-factor authenticated administrator session management.
- Worker status and capability monitoring for Infraxis Agents.

## Development

```bash
npm run dev
```

Runs on `http://localhost:3000` with API calls automatically proxied to Infraxis Core on `:8787`.

## Production Build

```bash
npm run build
```

Exports optimized static assets to `web/out/`, served directly by Infraxis Core.
