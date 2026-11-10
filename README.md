# Clause — personal contract maker

A small, Vercel deployable app for one owner to draft agreements and send a private client signing link by email. Clients do not need accounts. The frontend is plain HTML/CSS/JavaScript, with Vercel serverless API functions and a Neon Postgres database connected through Vercel Marketplace.

## Deploy

1. Put this folder in a GitHub repository and import it into Vercel.
2. In the Vercel project’s **Storage** tab, add the **Neon** Marketplace integration. Vercel connects the database and adds `DATABASE_URL` to the project environment. Open the Neon SQL Editor from the integration and run [`schema.sql`](schema.sql).
3. Create a Resend account and verify a sending domain.
4. Add these project environment variables in Vercel, then redeploy:

   - `APP_URL` — the public URL, e.g. `https://your-project.vercel.app` (no trailing slash)
   - `OWNER_PASSWORD` — a long, unique passphrase for your private contract workspace
   - `SESSION_SECRET` — a random secret of at least 32 characters for signing the owner’s eight-hour session cookie
   - `RESEND_API_KEY` — Resend API key
   - `FROM_EMAIL` — verified sender, e.g. `Agreements <agreements@yourdomain.com>`

   [`.env.example`](.env.example) lists the environment variables. The Neon integration supplies `DATABASE_URL`; do not paste it into browser code.

5. Set `APP_URL` to the deployed URL and redeploy. Sign in with your passphrase. Drafts are saved in that browser; clients get their own token-protected signing page.

Do not enable Vercel Deployment Protection for the entire site if clients must open signing links, since it would also block them. The owner app is protected by its passcode; client pages are accessible only through their high-entropy private token links.

## How it works

- Drafts are autosaved in your browser’s local storage.
- Your owner passcode creates an HTTP-only, signed eight-hour session cookie. Only signed-in sessions can create signature requests.
- Sending stores the agreement in Neon and emails the client a random signing link through Resend. The raw token is not stored; the database keeps only its SHA-256 hash.
- The client reviews the terms, types their name, and confirms intent to sign electronically. The app records the name, consent, timestamp, IP address, and browser user agent. A database update permits one signature per request.
- After signing, the sender gets an email containing the agreement text and signature record. The client can revisit the link and print the signed agreement to PDF.

## Scope and limits

This is a basic electronic-signature workflow, not a full e-signature compliance platform. It does not verify signer identity, provide tamper-evident document sealing, support multiple signers, or maintain a certified audit trail. The included templates are generic starting points, not legal advice; have important agreements reviewed for your jurisdiction and use case.
