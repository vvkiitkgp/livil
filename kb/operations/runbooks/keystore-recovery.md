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

**The highest-stakes document in this repository.**

Android requires every update to a listing to be signed with the same upload key. Lose that
key and **this Play Store listing can never be updated again**. Not "with difficulty" — the
app is frozen at its last published version, and continuing means a new listing with a new
package name and zero installed users.

Constitution P50: any artifact whose loss is unrecoverable is a systemic risk, and its
convenience today does not offset its cost on the day it is lost.

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

### If Play App Signing is enrolled

Google holds the app signing key; yours is only the *upload* key, and an upload key can be
reset.

1. Generate a new upload key
2. Request an upload key reset through Play Console support, with the new certificate
3. Wait for approval — **days, not hours**
4. Sign future releases with the new upload key

**Check whether Play App Signing is enrolled now, while nothing is wrong.** Play Console →
Setup → App integrity. If it is, the worst case is a delay rather than a permanent loss — and
that single fact changes the severity of everything on this page.

### If it is not enrolled

There is no recovery. The listing cannot be updated. The only path forward is a new listing
under a new package name, losing every install, rating, and review.

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
