---
tier: 3
owner: principal-platform
consumers: [DO, P-PF, human]
last_verified: 2026-07-21
verify_every: 180d
verified_by: manual
visibility: public
supersedes: []
related_adrs: []
---

# Runbook — Release Signing Key

**Play App Signing is ENROLLED. Losing the local keystore is recoverable.**

This document previously opened by claiming that losing this key means the listing "can never
be updated again." **That is false for this app**, and the correction matters more than
anything else on the page — it was driving a P0 that isn't one.

Livil publishes an **App Bundle** (`bundleRelease` → `.aab`), and Google Play *requires* Play
App Signing to publish an App Bundle. The listing was first released 2026-03-20, well after
the August 2021 mandate. There is no configuration in which this app is published and not
enrolled.

**What that means concretely:**

| | Who holds it | If lost |
|---|---|---|
| **App signing key** | **Google** | Not yours to lose. Google backs it up. |
| **Upload key** (`livil-release.keystore`) | This laptop, one copy | **Resettable** — request through Play Console support |

So the failure mode is *"a few days of delay and a support ticket"*, not *"the app is dead."*
Constitution P50 still applies — a single-copy artifact is still worth backing up — but the
cost of the bad day is days, not the product.

⚠️ **Do not delete the keystore on the strength of this.** An upload key reset is a manual
Google-side process with a real wait, and it is a worse day than opening a password manager.
Back it up. Just don't treat it as existential.

---

## What must survive

| Item | Location | In git? |
|---|---|---|
| Upload keystore | `android/app/livil-release.keystore` | **No** — gitignored, correctly |
| Store password | User-level Gradle properties | No |
| Key alias | User-level Gradle properties | No |
| Key password | User-level Gradle properties | No |

**All four are required. A keystore without its passwords is useless.**

Both currently exist on **one machine**. Neither is in any repository, by design — and neither
is anywhere else, by omission.

---

## Back it up (do this before the next release)

1. **Copy the keystore file** to a password manager as a file attachment, or to an encrypted
   archive held somewhere independent of the laptop.
2. **Store all four values together** — the file is worthless without the alias and passwords,
   and separating them is the most common way this fails.
3. **Second location**, on different infrastructure from the first. One copy is not a backup.
4. **Verify by restoring** — see below. A backup that has never been restored is a hypothesis.

Do **not**: commit it to any repository, public or private; email it; place it in shared cloud
storage that syncs to the working laptop only; or store the passwords in the same note as
nothing else.

---

## Verify a backup (do this annually)

The only meaningful test is producing a signed artifact from the restored copy on a machine
that is not the usual one.

```bash
# 1. Restore the keystore from backup to a scratch path
# 2. Confirm the alias and password actually open it
keytool -list -v -keystore /path/to/restored.keystore -alias <alias>

# 3. Build a release bundle against the restored copy
./gradlew bundleRelease \
  -PLIVIL_UPLOAD_STORE_FILE=/path/to/restored.keystore \
  -PLIVIL_UPLOAD_KEY_ALIAS=<alias> \
  -PLIVIL_UPLOAD_STORE_PASSWORD=<store-password> \
  -PLIVIL_UPLOAD_KEY_PASSWORD=<key-password>

# 4. Confirm the artifact is actually signed
jarsigner -verify -verbose -certs \
  android/app/build/outputs/bundle/release/app-release.aab
```

**Compare the certificate fingerprint against the one Play shows** for the app's upload key. A
build that signs successfully with the *wrong* key is still a dead end.

⚠️ The signing block fails open: if the properties are missing, Gradle produces an **unsigned**
bundle and reports success. Step 4 is not optional — it is the only thing that distinguishes
"signed correctly" from "silently unsigned".

Record the date in this document's `last_verified` field when you do this.

---

## If the key is lost

Act immediately; the options narrow with time.

Play App Signing is enrolled (see the top of this page), so this is a recovery, not a loss.
Google holds the app signing key; yours is only the *upload* key, and an upload key can be
reset.

1. Generate a new upload key with `keytool`
2. Request an **upload key reset** through Play Console → Help → Contact support, attaching
   the new certificate (`.pem`)
3. Wait for approval — **days, not hours.** Releases are blocked during this window
4. Sign future releases with the new upload key; the app signing key is unchanged, so
   existing installs update normally

Installed users are unaffected throughout — they only ever see Google's signature.

### Where enrolment is shown in Play Console

The nav has moved and the old pointers are dead ends: there is no "Setup" section, and
**Test and release → App integrity** now redirects to **Protected with Play**, which does not
show signing. Do not go looking for it during an incident — enrolment is already established
above by the fact that this app ships an App Bundle at all.

If you need the actual **certificate fingerprints** (e.g. to compare against a restored
backup, step 4 of the verification below), they are reachable from **Protected with Play →
Automatic protection → Manage**.

---

## Do not

- Commit the keystore anywhere, including the private knowledge base repository
- Rotate or regenerate it "to be safe" — rotation is the failure mode, not the mitigation
- Store passwords only in the shell history or a local file on the same machine
- Assume a backup works because it exists

---

## Status

| | |
|---|---|
| Keystore present on the primary machine | Yes |
| Backed up elsewhere | **Unverified — assume no** |
| Restore ever tested | **No** |
| Play App Signing enrolment | **Unknown — check this first** |

**These three unknowns are the open risk.** Resolving them takes under an hour and removes the
single most expensive failure mode in the project.
