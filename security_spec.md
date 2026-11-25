# CoinBridge P2P — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants

1. **Identity Integrity**: Every user-owned document (`users/{userId}`, `users/{userId}/private/*`, `wallets/{userId}`, `kyc_submissions/*`, `payment_accounts/*`, `wallet_transactions/*`, `merchants/*`) must bind its `uid` field strictly to `request.auth.uid` on creation and preserve `uid` immutably on update.
2. **PII Isolation**: Sensitive user PII (full legal name, email, mobile, residential address, date of birth) is isolated in `/users/{userId}/private/profile` and `/kyc_submissions/{submissionId}`, readable only by the owning user or verified compliance/admin staff.
3. **Zero Self-Privilege Escalation**: Users cannot assign themselves `ADMIN`, `SUPER_ADMIN`, `COMPLIANCE_OFFICER`, or `SUPPORT_AGENT` roles, nor approve their own KYC (`kycStatus: "APPROVED"`) or merchant verification (`verificationLevel: "PREMIUM"`).
4. **Order Party Confinement**: `p2p_orders/{orderId}` and `p2p_orders/{orderId}/events/{eventId}` are readable and updatable only by the order's `buyerUid`, `sellerUid`, or an authorized admin.
5. **Terminal State Locking**: Completed, cancelled, expired, or refunded orders (`COMPLETED`, `CANCELLED`, `EXPIRED`, `REFUNDED`) cannot be modified by buyers or sellers once terminal.
6. **Monetary Integer Safety**: All financial amounts (`rateInrPaise`, `usdtMicro`, `inrPaise`, `feeUsdtMicro`, `tdsInrPaise`, `availableUsdtMicro`, `reservedUsdtMicro`) are stored as non-negative integers in paise or micro-USDT (10^-6).
7. **Temporal Integrity**: `createdAt` and `updatedAt` timestamps on protected writes must match `request.time` and `createdAt` is immutable after creation.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)

1. **Self-Admin Role Escalation**: Unprivileged user creates `/users/{uid}` with `role: "SUPER_ADMIN"` or updates `role` to `"ADMIN"`.
2. **Self-KYC Approval**: User updates `/kyc_submissions/{id}` setting `status: "APPROVED"` or updates `/users/{uid}` setting `kycStatus: "APPROVED"`.
3. **Ghost Field Injection (Shadow Update)**: User updates `/p2p_orders/{id}` with `{ status: "PAYMENT_SUBMITTED", updatedAt: request.time, escrowReleasedByAdmin: true }`.
4. **Cross-User PII Read**: Authenticated Buyer A calls `get()` on `/users/{sellerUid}/private/profile` or `/kyc_submissions/{sellerKycId}`.
5. **Blanket List Query Scraping**: Authenticated user queries `p2p_orders` or `payment_accounts` or `notifications` without scoping `where('uid', '==', auth.uid)` / `buyerUid` / `sellerUid`.
6. **Order Impersonation**: Buyer A creates `/p2p_orders/{id}` with `buyerUid: "victim_uid"`.
7. **Terminal State Tampering**: Seller updates a `COMPLETED` order back to `DISPUTED` or `CANCELLED`.
8. **Unauthorized Payment Account Tampering**: User B updates or deletes User A's `/payment_accounts/{accountId}`.
9. **ID Poisoning**: Client writes to `/p2p_orders/../../admins/attacker` or a 1,500-character document ID.
10. **Unverified Email Admin Spoof**: Attacker signs in with unverified email (`email_verified: false`) matching the admin email and tries to update `/platform_settings/default`.
11. **Backdated Timestamp Spoofing**: User creates a `/p2p_orders/{id}` with a forged past `createdAt` timestamp instead of `request.time`.
12. **Audit Log Deletion / Tampering**: Non-admin or admin user tries to `update` or `delete` an immutable `/audit_logs/{logId}` entry.
