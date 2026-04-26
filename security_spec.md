# Security Specification: JobWatch-CH

## Data Invariants
1. **User Ownership**: A job tracking document must belong to the authenticated user who created it and cannot be accessed or modified by other users.
2. **Settings Isolation**: User settings are strictly private and can only be managed by the owner.
3. **Data Integrity**: All job documents must conform to the defined schema (Job entity).
4. **Identity Integrity**: The `userId` (implied in path) must match the authenticated `request.auth.uid`.
5. **No Orphaned Data**: Job status updates must be valid enum values.

## The "Dirty Dozen" Payloads

1. **Identity Spoofing (Read)**: Attempt to read jobs from `/users/victim_id/jobs` as `attacker_id`.
2. **Identity Spoofing (Write)**: Attempt to create a job in `/users/victim_id/jobs` as `attacker_id`.
3. **Blanket Query Attack**: Attempt a collection group query or top-level query for jobs that doesn't filter by owner.
4. **Settings Hijacking**: Attempt to update `/users/victim_id/settings/preferences` as `attacker_id`.
5. **Resource Poisoning (ID)**: Attempt to create a job with a 2MB string as `jobId`.
6. **Resource Poisoning (Field)**: Attempt to create a job with a 1MB company name.
7. **Type Breach**: Attempt to set `scrapedAt` to a boolean instead of a timestamp.
8. **Enum Violation**: Attempt to set `status` to "interviewing" (unsupported enum).
9. **Update Gap (Immutable Fields)**: Attempt to change `url` or `source` on an existing job.
10. **Shadow Field Attack**: Attempt to save `isAdmin: true` inside a job document.
11. **Denial of Wallet (Request Junk)**: Send a request with 100 unknown fields in the payload.
12. **Unverified Access**: Attempt a write operation as a user with `email_verified: false`.

## Test Runner (Conceptual)

All "Dirty Dozen" payloads must return `PERMISSION_DENIED` at the Firestore Rules layer.
