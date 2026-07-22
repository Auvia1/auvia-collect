# Auvia Collect: Detailed Product Features & Capabilities

Auvia Collect is an AI-driven, multi-tenant billing assistant and automated debt collection platform designed for clinics, medical centers, and hospitals. It replaces manual payment reminder calls with empathetic, conversational AI receptionist agents, integrated payment checkouts, and instant WhatsApp messaging.

Below is a detailed breakdown of all user-facing features and operational behaviors provided by Auvia Collect.

---

## 1. Clinic & Tenant Account Management
Auvia Collect is built from the ground up as a **multi-tenant platform**. This allows multiple distinct clinics to log into their own sandboxed accounts.
- **Custom AI Personality & Prompting**: Clinic administrators can customize the system prompt that guides the AI agent. They can define the agent's name (e.g., *Meher*), choose the tone (e.g., professional, warm, empathetic), set rules of engagement, and write clinic-specific instructions.
- **Isolated Telephony Configurations**: Each clinic integrates its own Vobiz caller IDs and dialing account details, ensuring caller ID labels show the clinic's real name.
- **Individual Payment Gateway Setup**: Clinics hook up their own Razorpay merchant credentials so that payment collections go directly to their respective bank accounts.
- **WhatsApp Channel Integration**: Each clinic registers its Meta WhatsApp Business Account (WABA) credentials, enabling reminders to appear directly from their verified phone number.
- **Prepaid Calling Credits**: Clinics purchase and maintain credit balances on the platform to fund automated outbound calls.

---

## 2. Debt Collection Campaigns & Roster Management
The platform makes it easy to schedule large-scale calling campaigns using contact rosters.
- **Excel/CSV Roster Upload**: Staff upload calling sheets containing patient names, phone numbers, outstanding due amounts, and specific payment descriptions (e.g., consultation fees, lab tests, operation charges).
- **Roster Validation & Clean-up**: Before triggering calls, the system presents an interactive roster dashboard where staff can review list rows, correct name spelling, clean up formatting errors, filter by due thresholds, and check/uncheck specific rows to choose exactly who gets called.
- **Campaign Controls**: Start, pause, resume, or terminate active dialing campaigns.
- **Dialing Concurrency Caps**: Clinic owners set the maximum number of calls that can be placed in parallel to ensure their staff are not overwhelmed by concurrent callback notifications.

---

## 3. Empathetic Voice Agent Call Interactions
When a call connects, the Auvia AI agent handles the entire conversation dynamically.
- **Identity Verification**: The AI agent begins by confirming it is speaking to the correct patient (e.g., *"Hello, am I speaking with Srinivasa?"*) to comply with privacy regulations before discussing financial records.
- **Natural Turn-Taking & Interruption Handling**: Patients can speak naturally or interrupt the bot mid-sentence. The AI agent instantly stops speaking, listens to the patient's comment, and adapts its response without repeating itself.
- **Out-of-Scope Redirection**: If a patient asks medical questions or wants to book new appointments, the billing bot politely explains that this is a billing reminder call and instructs them to call the clinic's primary helpline, keeping conversations focused on collection.
- **Dynamic Multilingual Support**: Calls start in English, but the patient can request Hindi or Telugu. The bot instantly switches languages mid-call to continue the conversation in the patient's preferred language.

---

## 4. Retries & Unanswered Call Behaviors
Auvia Collect automatically manages call outcomes when patients are unreachable or do not answer.
- **No-Answer & Busy Detection**: If a patient's line is busy, switched off, or rings without an answer, the system logs the status (e.g., `busy`, `no_answer`, `failed`).
- **Cooldown Periods & Retries**: Based on settings defined by the clinic, the campaign dialer automatically schedules retries after a configured cooldown period (e.g., retry after 6 hours, up to a maximum of 3 attempts) to ensure critical payment reminders are delivered without manually redialing.

---

## 5. Callback Queue & Scheduler
If a patient cannot pay immediately or is busy during the call, Auvia Collect handles scheduling a follow-up.
- **Conversational Callback Parsing**: If the patient tells the bot *"Call me back later at 4 PM"* or *"I'm in a meeting, call me tomorrow,"* the AI agent automatically extracts the requested date/time and changes the call's outcome status to `call_later`.
- **Scheduled Callback Dashboard**: Scheduled follow-ups enter a dedicated queue visible to clinic staff. The queue categorizes callbacks with real-time urgency indicators:
  - **Overdue Count**: Badges showing calls that missed their scheduled callback time.
  - **Due Today / Tomorrow / Future**: Groups callbacks logically so staff know who is due next.
  - **One-Click Manual Override**: Staff can review notes and click "Call Now" to immediately dispatch the AI agent to dial the patient at the requested time.

---

## 6. WhatsApp Payment Request Templates
Auvia Collect integrates WhatsApp templates directly into the call flow.
- **Dynamic Generation**: If the patient agrees to pay during the call, the AI agent instantly triggers a tool that communicates with Razorpay to generate a unique payment link.
- **Rich Media Template Cards**: Rather than sending a plain text SMS, Auvia Collect sends a Meta-approved template message (`auvia_collect_payment_link`) over WhatsApp. This message shows a professional header containing the clinic's name, a description of the payment reason, the due amount, and an interactive **"Pay Now"** button.

---

## 7. Automatic Payment Settlement & Receipt Alerts
The loop is closed automatically when a patient completes a transaction.
- **Cryptographic Webhook Security**: When a payment goes through, the system captures a notification from Razorpay, validates the signature, and matches the payment to the active call.
- **Automatic Ledger Updates**: The system reconciles the debt in the database in real-time, marking the payment link as `paid` and subtracting the captured amount from the patient's outstanding balance in the `contacts` database.
- **WhatsApp Receipts**: Upon successful payment, the system immediately sends a confirmed payment receipt template (`auvia_collect_payment_receipt`) over WhatsApp to the patient. This template serves as a transaction confirmation, displaying the hospital name, patient name, amount paid, transaction ID, and timestamp.

---

## 8. Logs, Analytics, & Auditing
Clinic managers have complete visibility into their billing operations.
- **Real-Time Call Monitoring**: A live dashboard displays active calls, current dial states (ringing, speaking), live conversational text transcripts, and call durations.
- **Call History Logs**: Access past call details including audio recordings (WAV files), full word-for-word chat transcripts, and specific call resolutions (e.g., `link_sent`, `call_later`, `wrong_number`, `unanswered`).
- **Cost & Performance Analytics**: Monitor total billing costs, clinic credit consumption rates, and campaigns performance charts to measure collection success.
