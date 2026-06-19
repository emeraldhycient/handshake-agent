# AGENTS.md

This repository's canonical guidance for AI agents lives in [`CLAUDE.md`](CLAUDE.md). Read it first.

Per-package guidance:

- Backend (NestJS): [`api/CLAUDE.md`](api/CLAUDE.md)
- Frontend (Next.js): [`web/CLAUDE.md`](web/CLAUDE.md) — also see [`web/AGENTS.md`](web/AGENTS.md) for the Next.js 16 caveat
- Shared contracts: [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md)

The non-negotiable invariants (model never moves money, agent never touches the DB, server-side KYC gating) are in `CLAUDE.md` §3. Do not write code that touches the transaction path without reading [`docs/PRD.md`](docs/PRD.md) §4.
