---
tier: 3
owner: chief-architect
consumers: [ALL]
last_verified: 2026-07-20
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Knowledge Base Specification

The rules the knowledge base itself follows. Every document under `kb/` is validated
against this spec by `npm run kb:validate`.

Authority: this spec is subordinate to [the Engineering Constitution](ENGINEERING_CONSTITUTION.md).
Where they conflict, the Constitution governs and the conflict is a defect.

---

## 1. Why this exists

A knowledge base that drifts is worse than none (Constitution P40). This spec exists so
that drift is **structurally prevented** rather than periodically corrected. It does that
by assigning every document a *tier* that determines how its truth is maintained, and by
making a validator responsible for the rules a human would otherwise have to remember.

---

## 2. The tier model

Every document declares a tier. The tier determines who maintains it, whether agents may
write it, and how it is kept true.

| Tier | Truth maintained by | Can drift? | Agents may write? |
|------|--------------------|-----------|-------------------|
| **1 — Generated** | A script, from code or schema. CI fails on diff. | **No** | Never — regenerate only |
| **2 — Enforced** | Hand-written, with an automated conformance check | Partially | Propose only |
| **3 — Curated** | Human review on a cadence + drift detection | Yes | Propose only |
| **4 — Append-only** | Immutable by construction | **No** | Append only |
| **5 — Narrative** | Human authority; low volatility | Yes | **Never** |

**The design goal is to push as much as possible into Tier 1 and Tier 4**, because both are
structurally incapable of drifting — T1 is regenerated, T4 is never edited. Historical doc
drift in this project occurred entirely in what would now be Tier 3. Keep Tier 3 small
enough that it can actually be reviewed.

A Tier 2 document whose enforcement mechanism has been removed is **demoted to Tier 3** and
flagged. A rule with no enforcement is marked `ADVISORY` inline, and is a candidate for
either automation or deletion.

---

## 3. Frontmatter

Every document under `kb/` must begin with YAML frontmatter:

```yaml
---
tier: 3                          # 1-5 (required)
owner: principal-playback        # exactly one accountable role (required)
consumers: [P-PB, CR, QA, FE]    # roles that read this (required)
last_verified: 2026-07-20        # human confirmation date (required)
verify_every: 90d                # freshness SLA (required)
verified_by: manual              # manual | generated | ci-enforced (required)
visibility: public               # public | private-content (required)
supersedes: []                   # doc paths this replaces
related_adrs: [0001, 0007]       # ADR numbers
---
```

### `last_verified` is not git mtime

A typo fix is not verification. **Verification is someone confirming the content is still
true.** These are deliberately different, and only the former is tracked in git. A document
past its `verify_every` window is stale regardless of how recently it was edited.

### Valid `owner` values

One of the six approved principal domains, or `chief-architect`, `human`, or `generated`:

`principal-playback` · `principal-data` · `principal-client` · `principal-security` ·
`principal-realtime` · `principal-platform` · `chief-architect` · `human` · `generated`

**Every document has exactly one owner** (Constitution P48). Shared ownership is no ownership.

---

## 4. Visibility and the private-content mechanism

**This repository is public** (`github.com/vvkiitkgp/livil`), and `docs/` is the published
GitHub Pages root for `livil-music.com`. The knowledge base therefore lives at `kb/` — never
`docs/` — so that it is not served on the marketing domain.

Because the repo is public, some documents cannot hold their real content here.

### `visibility: public`
Default. Content lives in this repo and is world-readable. Applies to architecture
narratives, standards, glossary, ADRs describing design choices, and this spec.

### `visibility: private-content`
The document at this path is a **stub**. It states what the real document covers, where it
lives, and who can reach it — but contains **no sensitive detail**. The real content lives
outside this repository.

Documents that must be `private-content`:

| Path | Why |
|------|-----|
| `kb/security/threat-model.md` | Enumerates attack surface |
| `kb/security/rls-policies.md` | Flags permissive and missing policies by design |
| `kb/architecture/rpc-reference.md` | Flags privileged functions lacking authorization guards |
| `kb/incidents/*` | Historical vulnerability detail |
| `kb/debt/register.md` | Ranked inventory of known-weak areas |

### Where private content lives

Private documents are stored at `kb/private/`, which is **gitignored in this repository**.
The backing store is a separate private repository cloned into that path, so the content is
still versioned, reviewed, and backed up.

**`kb/private/` must never be committed here.** The validator fails if any tracked file
appears under it. Storing this content only on one machine would create exactly the class of
unrecoverable single point of failure the Constitution forbids (P50) — the private repo is
what prevents that.

### Rules for stubs

- A stub must not restate the sensitive content it points to
- A stub must name the real document and its location
- Generators that produce private content write to `kb/private/`, and write only the stub
  to the public path
- An agent that cannot read `kb/private/` says so explicitly rather than reasoning from the
  stub as if it were complete (Constitution P6)

---

## 5. Authority order

When documents conflict:

1. **Engineering Constitution** (highest)
2. **ADRs** (`kb/decisions/`)
3. **Architecture and security documents**
4. **Standards**
5. Everything else

**A conflict between documents is a defect, not ambiguity to be interpreted.** An agent
finding one reports it rather than picking a side (Constitution, Part XVIII).

---

## 6. No fact lives in two places

Cross-reference; never duplicate. Duplicated facts diverge — this is precisely how a version
number came to be stated correctly in one file and incorrectly in two others.

If a fact is needed in two documents, it belongs in one of them and is linked from the other.
If it is needed in many, it is probably Tier 1 and should be generated.

---

## 7. Context budget

A knowledge base too large to load is as useless as none. Loading is layered:

| Layer | What | Budget |
|-------|------|--------|
| **Always** | `kb/INDEX.md` + `kb/architecture/overview.md` + Constitution | ~500 lines |
| **By domain** | The 1–2 documents INDEX routes to | ~400 lines |
| **On demand** | ADRs, incidents, generated references | as needed |
| **Co-located** | Scoped `CLAUDE.md` beside the code, pointing into `kb/` | automatic |

### Enforced size caps

- `kb/INDEX.md` — **200 lines**
- `kb/architecture/overview.md` — **200 lines**

These are validated, not suggested. If either grows past its cap, routing has failed —
which is the entire point of having them. `overview.md` deliberately explains nothing; it
points. Fix by moving content into a domain document, never by raising the cap.

---

## 8. Structural rules the validator enforces

1. Every `.md` under `kb/` has complete, well-formed frontmatter
2. `tier` is 1–5; `owner` is a recognized role; `visibility` is a recognized value
3. Every document is reachable from `kb/INDEX.md` — **an orphaned document is a defect** (P48)
4. Size caps hold for capped documents
5. No tracked files exist under `kb/private/`
6. `visibility: private-content` documents are stubs and stay under a low line count
7. Documents past `verify_every` are reported as stale (warning, not failure)
8. Internal links resolve

Rules 1–6 fail the build. Rules 7–8 warn.

---

## 9. How this spec evolves

Tier 3, owned by `chief-architect`, reviewed every 180 days.

Changes to the tier model, frontmatter schema, or authority order are **architectural
decisions** and require an ADR — every document in the knowledge base depends on them, and
changing them is expensive in proportion.

Adding a validator rule is not an architectural decision and needs no ADR. Prefer adding
enforcement over adding prose (Constitution P1, P39).
