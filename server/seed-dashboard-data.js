import db from './db.js';
import bcrypt from 'bcryptjs';

const clinicId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const staffEmail = 'staff@auvia.com';
const actorId = '66666666-7777-8888-9999-000000000000'; // Staff user ID

const INDIAN_NAMES = [
  'Rajesh Kumar', 'Amit Patel', 'Priya Sharma', 'Suresh Naidu', 'Lakshmi Prasad',
  'Venkatesh Rao', 'Ananya Reddy', 'Srinivasa Murthy', 'Geetha Nair', 'Karan Johar',
  'Deepika Padukone', 'Ranveer Singh', 'Neha Gupta', 'Vikram Seth', 'Sunita Williams',
  'Aditya Birla', 'Rohan Gavaskar', 'Shreya Ghoshal', 'Aravind Swamy', 'Meera Jasmine',
  'Siddharth Narayan', 'Trisha Krishnan', 'Vijay Raghavan', 'Preethi Shenoy', 'Hari Prasad'
];

const CAMPAIGN_TEMPLATES = [
  { prefix: 'Cardiology Billing', context: 'consultation_fee' },
  { prefix: 'Outpatient Roster', context: 'other' },
  { prefix: 'Orthopedics Settlement', context: 'admission_charges' },
  { prefix: 'Dental Recovery', context: 'consultation_fee' },
  { prefix: 'Lab Invoice Reminders', context: 'lab_charges' },
  { prefix: 'Pharmacy Outstanding', context: 'pharmacy_bill' },
  { prefix: 'General Wellness Drive', context: 'other' }
];

async function seedData() {
  console.log('Starting custom dashboard data seeding...');

  try {
    await db.query('BEGIN');

    // 1. Update staff password to '12345'
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash('12345', salt);
    await db.query(
      `UPDATE app_users SET password_hash = $1 WHERE email = $2`,
      [passwordHash, staffEmail]
    );
    console.log(`Updated password for ${staffEmail} to '12345'`);

    // 2. Clean up existing mock campaigns (keep seeded ones if needed, or clear all for this clinic)
    // To prevent duplicate keys, let's delete campaigns for this clinic created in the past except the core ones,
    // or just let them stay and append new monthly campaigns. Let's delete all contacts/calls/payments
    // for this clinic's campaigns to have a perfectly clean trend chart.
    console.log('Cleaning up campaigns for clinic:', clinicId);
    await db.query(`DELETE FROM payments WHERE clinic_id = $1`, [clinicId]);
    await db.query(`DELETE FROM payment_links WHERE clinic_id = $1`, [clinicId]);
    await db.query(`DELETE FROM calls WHERE clinic_id = $1`, [clinicId]);
    await db.query(`DELETE FROM contacts WHERE clinic_id = $1`, [clinicId]);
    await db.query(`DELETE FROM campaigns WHERE clinic_id = $1`, [clinicId]);

    // 3. Generate Campaigns for the last 6 months (Feb, Mar, Apr, May, Jun, Jul 2026)
    // Current date is July 23, 2026
    const months = [
      { name: 'Feb', offset: 5, date: '2026-02-15' },
      { name: 'Mar', offset: 4, date: '2026-03-15' },
      { name: 'Apr', offset: 3, date: '2026-04-15' },
      { name: 'May', offset: 2, date: '2026-05-15' },
      { name: 'Jun', offset: 1, date: '2026-06-15' },
      { name: 'Jul', offset: 0, date: '2026-07-15' }
    ];

    let campaignCounter = 1;

    for (const m of months) {
      // Determine number of campaigns for this month (1 to 2 campaigns per month)
      const numCampaigns = Math.floor(Math.random() * 2) + 1;

      for (let i = 0; i < numCampaigns; i++) {
        const template = CAMPAIGN_TEMPLATES[Math.floor(Math.random() * CAMPAIGN_TEMPLATES.length)];
        const campaignName = `${m.name} 2026 ${template.prefix} (C${campaignCounter})`;
        const campaignId = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
        const status = m.name === 'Jul' ? 'active' : 'completed';
        const createdDate = `${m.date} 10:00:00`;

        console.log(`Creating campaign: ${campaignName} for ${m.name}`);

        // Insert campaign
        await db.query(
          `INSERT INTO campaigns (id, clinic_id, name, status, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [campaignId, clinicId, campaignName, status, actorId, createdDate]
        );

        // Generate Contacts for this campaign (5 to 10 contacts per campaign)
        const numContacts = Math.floor(Math.random() * 6) + 5;
        let totalDue = 0;
        let selectedContactsCount = 0;

        for (let j = 0; j < numContacts; j++) {
          const contactId = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
          const patientName = INDIAN_NAMES[Math.floor(Math.random() * INDIAN_NAMES.length)] + ` (${campaignCounter}${j})`;
          const phone = `+9199999${campaignCounter}${j.toString().padStart(2, '0')}`;
          
          // Random due amount from ₹300 to ₹12,000
          const amountDue = parseFloat((Math.random() * 11700 + 300).toFixed(2));
          const isSelected = Math.random() > 0.1; // 90% selected
          
          totalDue += isSelected ? amountDue : 0;
          selectedContactsCount += isSelected ? 1 : 0;

          await db.query(
            `INSERT INTO contacts (id, campaign_id, clinic_id, name, phone, amount_due, payment_context, is_selected, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [contactId, campaignId, clinicId, patientName, phone, amountDue, template.context, isSelected, createdDate]
          );

          if (isSelected) {
            // Generate call attempt
            const callId = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
            const callStatus = 'completed';
            
            // Call outcomes: 40% Paid, 30% Sent Link (Pending), 20% Callback, 10% Unpaid/Busy
            const outcomeRand = Math.random();
            let outcome = null;
            let callStatusVal = 'completed';

            if (outcomeRand < 0.4) {
              outcome = 'paid_now';
            } else if (outcomeRand < 0.7) {
              outcome = 'link_sent';
            } else if (outcomeRand < 0.9) {
              outcome = 'call_later';
            } else {
              callStatusVal = Math.random() > 0.5 ? 'not_answered' : 'failed';
            }

            const durationSeconds = callStatusVal === 'completed' ? Math.floor(Math.random() * 150) + 30 : 0;
            const creditsBilled = callStatusVal === 'completed' ? Math.ceil(durationSeconds / 60) : 0;

            await db.query(
              `INSERT INTO calls (id, contact_id, campaign_id, clinic_id, attempt_number, call_status, outcome, duration_seconds, credits_billed, created_at)
               VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9)`,
              [callId, contactId, campaignId, clinicId, callStatusVal, outcome, durationSeconds, creditsBilled, createdDate]
            );

            // Handle payment links and actual payments if outcome is paid_now or link_sent
            if (outcome === 'paid_now' || (outcome === 'link_sent' && Math.random() > 0.5)) {
              // Paid payment
              const plinkId = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
              const linkStatus = 'paid';
              const rzpLinkId = `plink_${campaignCounter}_${j}`;
              const rzppayId = `pay_${campaignCounter}_${j}`;

              // Create payment link
              await db.query(
                `INSERT INTO payment_links (id, call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at, paid_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'whatsapp', $10, $10, $10)`,
                [plinkId, callId, contactId, campaignId, clinicId, rzpLinkId, `https://rzp.io/i/${rzpLinkId}`, amountDue, linkStatus, createdDate]
              );

              // Create payment row in the payments table
              await db.query(
                `INSERT INTO payments (id, payment_link_id, contact_id, clinic_id, razorpay_payment_id, amount_paid, method, paid_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'upi', $7, $7)`,
                [crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid, plinkId, contactId, clinicId, rzppayId, amountDue, createdDate]
              );
            } else if (outcome === 'link_sent') {
              // Unpaid payment link (Pending state)
              const plinkId = crypto.randomUUID ? crypto.randomUUID() : (await db.query('SELECT gen_random_uuid() as uuid')).rows[0].uuid;
              const linkStatus = 'sent';
              const rzpLinkId = `plink_pending_${campaignCounter}_${j}`;

              await db.query(
                `INSERT INTO payment_links (id, call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'whatsapp', $10, $10)`,
                [plinkId, callId, contactId, campaignId, clinicId, rzpLinkId, `https://rzp.io/i/${rzpLinkId}`, amountDue, linkStatus, createdDate]
              );
            }
          }
        }

        // Update campaign totals
        await db.query(
          `UPDATE campaigns 
           SET total_contacts = $1, selected_contacts = $2, total_amount_due = $3
           WHERE id = $4`,
          [numContacts, selectedContactsCount, totalDue, campaignId]
        );

        campaignCounter++;
      }
    }

    await db.query('COMMIT');
    console.log('Custom dashboard data seeded successfully!');
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Data seeding failed:', err);
  } finally {
    process.exit(0);
  }
}

seedData();
