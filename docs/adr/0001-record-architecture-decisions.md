# 1. Record architecture decisions

Date: 2026-06-18

## Status

Accepted

## Context

We need to record the architectural decisions made on this project, so the reasoning behind significant choices is available to future contributors and AI agents rather than living only in chat history.

## Decision

We will use Architecture Decision Records, as described by Michael Nygard. Each record is a short markdown file in `docs/adr/`, numbered sequentially (`NNNN-title.md`), with sections: Context, Decision, Consequences, and a Status (Proposed / Accepted / Superseded by ADR-NNNN).

Write an ADR for any decision that is costly to reverse or that a newcomer would otherwise ask "why was it done this way?" — choice of framework, a cross-cutting pattern, a security invariant, a major dependency. Do not write ADRs for routine implementation choices.

## Consequences

- Decisions and their rationale are discoverable in the repo.
- Superseding a decision means adding a new ADR and marking the old one `Superseded by ADR-NNNN`, never editing history.
- The root [`CLAUDE.md`](../../CLAUDE.md) links here for the decision log.
