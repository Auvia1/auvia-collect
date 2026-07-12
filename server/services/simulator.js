import db from '../db.js';

// Random element helper
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function formatContext(ctx) {
  if (!ctx) return 'medical services';
  return ctx.replace(/_/g, ' ');
}

const TRANSCRIPTS = {
  paid_now: [
    { from: 'agent', text: 'Hello, this is Auvia Wellness. Am I speaking with {{name}}?', at_seconds: 2 },
    { from: 'customer', text: 'Yes, this is {{name}}. What is this about?', at_seconds: 5 },
    { from: 'agent', text: 'Hi! I am calling regarding a pending balance of ₹{{amount}} for your {{context}}. We can send a secure SMS payment link if you would like to clear this now.', at_seconds: 12 },
    { from: 'customer', text: 'Oh yes, I received the email but forgot. Please send the link, I will pay it right now.', at_seconds: 20 },
    { from: 'agent', text: 'Excellent, sent. Let me know when you receive it.', at_seconds: 27 },
    { from: 'customer', text: 'Just got it. Clicking now... entering UPI pin... okay, it says success!', at_seconds: 45 },
    { from: 'agent', text: 'Perfect, I see the transaction completed on my end. Thank you so much for your payment!', at_seconds: 52 },
    { from: 'customer', text: 'No problem, thank you. Bye!', at_seconds: 56 }
  ],
  link_sent: [
    { from: 'agent', text: 'Hello, is this {{name}}?', at_seconds: 2 },
    { from: 'customer', text: 'Yes, who is this?', at_seconds: 4 },
    { from: 'agent', text: 'I am calling from Auvia Wellness regarding a balance of ₹{{amount}} for your {{context}}. We would like to text you a quick link to settle it.', at_seconds: 10 },
    { from: 'customer', text: 'Sure, send it over. I am currently driving, but I will pay it as soon as I get home.', at_seconds: 18 },
    { from: 'agent', text: 'Absolutely. The link is sent to this number. Have a safe drive!', at_seconds: 25 },
    { from: 'customer', text: 'Thanks, talk to you later.', at_seconds: 30 }
  ],
  call_later: [
    { from: 'agent', text: 'Hello {{name}}? I am calling from Auvia Wellness regarding your outstanding {{context}} of ₹{{amount}}.', at_seconds: 3 },
    { from: 'customer', text: 'Hi, I am actually in a meeting right now. Can you call me back later this afternoon?', at_seconds: 10 },
    { from: 'agent', text: 'Of course! Would 4:00 PM today work for you?', at_seconds: 15 },
    { from: 'customer', text: 'Yes, 4:00 PM works. Please call me then.', at_seconds: 20 },
    { from: 'agent', text: 'Perfect. I have scheduled a callback. Have a great day!', at_seconds: 25 }
  ],
  not_interested: [
    { from: 'agent', text: 'Hello {{name}}? I am calling from Auvia Wellness regarding a pending invoice for your {{context}}.', at_seconds: 3 },
    { from: 'customer', text: 'I already disputed this with my insurance company. I am not paying this bill until they resolve it.', at_seconds: 9 },
    { from: 'agent', text: 'I understand. Let me make a note of this so our billing team can review your insurance claims.', at_seconds: 16 },
    { from: 'customer', text: 'Yes, please do. Do not call me again until then. Goodbye.', at_seconds: 22 }
  ]
};

const SUMMARIES = {
  paid_now: 'Spoke with {{name}}. Patient was helpful and paid the outstanding balance of ₹{{amount}} for their {{context}} immediately over the phone using the sent Razorpay SMS link.',
  link_sent: 'Spoke with {{name}}. Patient was busy but cooperative. Sent payment link of ₹{{amount}} for their {{context}} via WhatsApp. Patient promised to pay later today.',
  call_later: 'Patient {{name}} was busy and requested a callback regarding their {{context}}. Scheduled callback for today/tomorrow.',
  already_paid: 'Spoke with {{name}}. Patient claims the {{context}} bill was already cleared via their insurer. Marked for billing audit.',
  not_interested: 'Patient {{name}} declined to pay for their {{context}}, stating insurance should cover the full charges. Billing dispute noted.',
  not_answered: 'Call went to voicemail. Sent fallback SMS reminder to patient.',
  failed: 'Call dropped due to network issues or number disconnected.'
};

// Active simulators cache so we don't start multiple intervals for the same campaign
const activeSimulators = new Map();

export function startCampaignSimulation(campaignId, clinicId) {
  if (activeSimulators.has(campaignId)) return;

  console.log(`[Simulator] Starting call simulations for campaign: ${campaignId}`);
  
  // Running simulation in a timer loop
  const intervalId = setInterval(async () => {
    try {
      // 1. Get campaign status. If not active, stop simulation.
      const campRes = await db.query('SELECT status FROM campaigns WHERE id = $1', [campaignId]);
      if (campRes.rows.length === 0 || campRes.rows[0].status !== 'active') {
        console.log(`[Simulator] Campaign ${campaignId} is no longer active. Stopping.`);
        clearInterval(intervalId);
        activeSimulators.delete(campaignId);
        return;
      }

      // 2. Find a contact that hasn't been called in this campaign
      const contactRes = await db.query(
        `SELECT c.id, c.name, c.phone, c.amount_due, c.payment_context
         FROM contacts c
         LEFT JOIN calls call ON call.contact_id = c.id
         WHERE c.campaign_id = $1 AND c.is_selected = true AND call.id IS NULL
         LIMIT 1`,
        [campaignId]
      );

      if (contactRes.rows.length === 0) {
        // No more contacts to call! Campaign completed.
        console.log(`[Simulator] Campaign ${campaignId} calls completed! Updating campaign status.`);
        await db.query(
          `UPDATE campaigns SET status = 'completed', completed_at = now() WHERE id = $1`,
          [campaignId]
        );
        clearInterval(intervalId);
        activeSimulators.delete(campaignId);
        return;
      }

      const contact = contactRes.rows[0];
      const amount = parseFloat(contact.amount_due);

      console.log(`[Simulator] Dialing ${contact.name} (${contact.phone}) for campaign: ${campaignId}`);

      // 3. Create call in status 'in_progress'
      const callUuidResult = await db.query(
        `INSERT INTO calls (contact_id, campaign_id, clinic_id, attempt_number, call_status, started_at, amount)
         VALUES ($1, $2, $3, 1, 'in_progress', now(), $4)
         RETURNING id`,
        [contact.id, campaignId, clinicId, amount]
      );
      const callId = callUuidResult.rows[0].id;

      // 4. Simulate conversation. We wait 6 seconds and then resolve the call.
      setTimeout(async () => {
        try {
          // Determine outcome
          const roll = Math.random();
          let outcome = 'link_sent';
          let callStatus = 'completed';
          let sentiment = 'neutral';
          let callbackDate = null;
          let callbackTime = null;
          let declineReason = null;

          if (roll < 0.35) {
            outcome = 'paid_now';
            sentiment = pick(['friendly', 'happy']);
          } else if (roll < 0.65) {
            outcome = 'link_sent';
            sentiment = 'neutral';
          } else if (roll < 0.8) {
            outcome = 'call_later';
            sentiment = 'cooperative';
            // Schedule callback for tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            callbackDate = tomorrow.toISOString().substring(0, 10);
            callbackTime = '14:30:00';
          } else if (roll < 0.9) {
            outcome = 'not_interested';
            sentiment = 'frustrated';
            declineReason = pick(['not_interested', 'financial_issues', 'payment_already_done', 'wrong_person', 'other']);
          } else {
            // Unanswered/Failed
            callStatus = pick(['not_answered', 'failed']);
            outcome = null;
          }

          // Build transcript & summaries
          let transcriptText = null;
          const formattedCtx = formatContext(contact.payment_context);
          if (callStatus === 'completed' && outcome) {
            const tmpl = TRANSCRIPTS[outcome] || TRANSCRIPTS['link_sent'];
            transcriptText = JSON.stringify(
              tmpl.map(t => ({
                ...t,
                text: t.text
                  .replace(/{{name}}/g, contact.name)
                  .replace(/{{amount}}/g, amount.toFixed(2))
                  .replace(/{{context}}/g, formattedCtx)
              }))
            );
          }

          const sumTmpl = SUMMARIES[outcome || callStatus];
          const summary = sumTmpl
            .replace(/{{name}}/g, contact.name)
            .replace(/{{amount}}/g, amount.toFixed(2))
            .replace(/{{context}}/g, formattedCtx);

          const durationSeconds = callStatus === 'completed' ? pick([45, 60, 95, 120, 180]) : pick([5, 12]);
                    const recordingUrl = callStatus === 'completed' ? 'https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg' : null;
          const creditsBilled = Math.ceil(durationSeconds / 60);

          const inr_multiplier = 94.94;
          const telephony_cost = creditsBilled * 0.0071 * inr_multiplier;
          const stt_cost = creditsBilled * 0.0024 * inr_multiplier;
          const ttsCharCount = callStatus === 'completed' ? (durationSeconds * 5) : 0;
          const tts_cost = ttsCharCount * (0.02 / 1000.0) * inr_multiplier;
          const llm_cost = (ttsCharCount / 4.0) * (0.015 / 1000.0) * inr_multiplier;
          const total_cost = telephony_cost + stt_cost + tts_cost + llm_cost;

          const billingObj = {
            duration: durationSeconds,
            stt_cost: stt_cost,
            tts_cost: tts_cost,
            llm_cost: llm_cost,
            telephony_cost: telephony_cost,
            total_cost: total_cost,
            credits_billed: creditsBilled
          };

          console.log(`[Simulator] Call ${callId} completed with outcome: ${outcome || callStatus} | Credits billed: ${creditsBilled}`);

          // Update call in DB
          await db.query(
            `UPDATE calls 
             SET call_status = $1, outcome = $2, sentiment = $3, duration_seconds = $4,
                 recording_url = $5, transcript = $6, ai_summary = $7,
                 callback_date = $8, callback_time = $9, decline_reason = $10, ended_at = now(),
                 amount = $11, billing = $12
             WHERE id = $13`,
            [callStatus, outcome, sentiment, durationSeconds, recordingUrl, transcriptText, summary, callbackDate, callbackTime, declineReason, creditsBilled, JSON.stringify(billingObj), callId]
          );

          // Deduct credits from clinic
          if (creditsBilled > 0) {
            await db.query(
              `UPDATE clinics SET credits = COALESCE(credits, 0) - $1 WHERE id = $2`,
              [creditsBilled, clinicId]
            );
          }

          // Insert call cost breakdown for cost analytics
          try {
            await db.query(
              `INSERT INTO public.call_cost_breakdown (
                 call_id, clinic_id, duration_seconds, duration_minutes, stt_cost, stt_provider, 
                 tts_cost, tts_provider, llm_in_cost, llm_out_cost, telephony_cost, telephony_provider, 
                 other_cost, credits_billed, total_cost, bill
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
              [
                callId,
                clinicId,
                durationSeconds,
                durationSeconds / 60.0,
                stt_cost,
                'sarvam',
                tts_cost,
                'smallest',
                llm_cost * 0.4,
                llm_cost * 0.6,
                telephony_cost,
                'vobiz',
                0, // other_cost
                creditsBilled,
                total_cost,
                JSON.stringify(billingObj)
              ]
            );
          } catch (cbErr) {
            console.error('[Simulator] Error inserting call cost breakdown:', cbErr);
          }

          // Handle Razorpay payment link simulation
          if (outcome === 'paid_now') {
            const rzpLinkId = `rzp_link_${Math.random().toString(36).substring(2, 10)}`;
            const plinkResult = await db.query(
              `INSERT INTO payment_links (call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at, paid_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', 'whatsapp', now(), now())
               RETURNING id`,
              [callId, contact.id, campaignId, clinicId, rzpLinkId, `https://rzp.io/i/${rzpLinkId}`, amount]
            );

            await db.query(
              `INSERT INTO payments (payment_link_id, contact_id, clinic_id, razorpay_payment_id, amount_paid, method, paid_at)
               VALUES ($1, $2, $3, $4, $5, 'upi', now())`,
              [plinkResult.rows[0].id, contact.id, clinicId, `pay_sim_${Math.random().toString(36).substring(2, 10)}`, amount]
            );
          } else if (outcome === 'link_sent') {
            const rzpLinkId = `rzp_link_${Math.random().toString(36).substring(2, 10)}`;
            const plinkResult = await db.query(
              `INSERT INTO payment_links (call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', 'sms', now())
               RETURNING id`,
              [callId, contact.id, campaignId, clinicId, rzpLinkId, `https://rzp.io/i/${rzpLinkId}`, amount]
            );

            // Simulate the user clicking the link and paying 8 seconds later!
            setTimeout(async () => {
              try {
                // Confirm they haven't manually changed it
                const plinkId = plinkResult.rows[0].id;
                await db.query(
                  `UPDATE payment_links SET status = 'paid', paid_at = now() WHERE id = $1`,
                  [plinkId]
                );

                await db.query(
                  `INSERT INTO payments (payment_link_id, contact_id, clinic_id, razorpay_payment_id, amount_paid, method, paid_at)
                   VALUES ($1, $2, $3, $4, $5, 'card', now())`,
                  [plinkId, contact.id, clinicId, `pay_sim_${Math.random().toString(36).substring(2, 10)}`, amount]
                );
                console.log(`[Simulator] Customer ${contact.name} paid link: ${rzpLinkId} (₹${amount})!`);
              } catch (e) {
                console.error('[Simulator] Delay payment error:', e);
              }
            }, 8000);
          }

        } catch (e) {
          console.error('[Simulator] Inner timer task error:', e);
        }
      }, 6000);

    } catch (e) {
      console.error('[Simulator] Interval tick error:', e);
    }
  }, 12000); // Dial a new customer every 12 seconds

  activeSimulators.set(campaignId, intervalId);
}
