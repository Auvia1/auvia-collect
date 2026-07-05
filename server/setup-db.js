import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

console.log('Connecting to database...');
const client = new pg.Client({ connectionString });
await client.connect();

try {
  console.log('1. Bootstrapping "auth" schema and helper functions...');
  
  // Create auth schema & users table if running on vanilla Postgres
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql STABLE
    AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')
      )::uuid;
    $$;
  `);

  console.log('2. Running schema.sql...');
  const schemaPath = path.join(process.cwd(), '..', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Run the schema.sql. Note that since schema.sql has some statements like "create extension if not exists",
  // we can run them directly. We wrap in a transaction to ensure all or nothing.
  await client.query('BEGIN');
  
  // Note: some commands like "create extension" might not run in a transaction block on some PG configs.
  // But let's run the schema as a whole block.
  await client.query(schemaSql);
  await client.query('COMMIT');
  console.log('schema.sql executed successfully.');

  console.log('3. Seeding mock data...');

  // Generate UUIDs for seed records so they are consistent
  const clinicId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  const adminId = '11111111-2222-3333-4444-555555555555';
  const staffId = '66666666-7777-8888-9999-000000000000';

  // Insert mock users into auth.users (this will automatically trigger handle_new_user and create profiles)
  console.log('Seeding authentication users...');
  
  // Clean up existing profiles/auth.users if any
  await client.query('TRUNCATE auth.users CASCADE');
  await client.query('TRUNCATE clinics CASCADE');
  
  await client.query(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
      ('${adminId}', 'admin@auvia.com', '{"full_name": "Dr. Sarah Jenkins"}'::jsonb),
      ('${staffId}', 'staff@auvia.com', '{"full_name": "John Doe"}'::jsonb)
  `);

  // Update platform_role to admin
  await client.query(`
    UPDATE profiles SET platform_role = 'platform_admin' WHERE email = 'admin@auvia.com'
  `);

  console.log('Seeding clinic...');
  // Seed clinic
  await client.query(`
    INSERT INTO clinics (
      id, name, slug, address, city, state, phone, billing_email, status,
      razorpay_key_id, razorpay_key_secret, whatsapp_sender_id, sms_sender_id, preferred_channel,
      max_retry_attempts, retry_cooldown_hours, calling_window_start, calling_window_end, max_concurrent_calls,
      created_by
    ) VALUES (
      '${clinicId}', 'Auvia Wellness Center', 'auvia-wellness', '123 Healthcare Blvd', 'Bangalore', 'Karnataka', 
      '+919876543210', 'billing@auvia.com', 'active',
      'rzp_test_key123', 'rzp_test_secret456', '+919876543211', 'AUVIAC', 'whatsapp',
      3, 6, '09:00', '19:00', 5,
      '${adminId}'
    )
  `);

  console.log('Seeding clinic members...');
  // Add users as members of the clinic
  await client.query(`
    INSERT INTO clinic_members (clinic_id, user_id, invited_email, role, status, joined_at)
    VALUES 
      ('${clinicId}', '${adminId}', 'admin@auvia.com', 'admin', 'active', now()),
      ('${clinicId}', '${staffId}', 'staff@auvia.com', 'staff', 'active', now())
  `);

  console.log('Seeding campaigns...');
  // Seed campaigns
  const campaigns = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'July 2026 Collection Drive',
      status: 'active',
      total_contacts: 5,
      selected_contacts: 4,
      total_amount_due: 1411.50,
      created_by: adminId,
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Q2 Wellness Follow-up',
      status: 'active',
      total_contacts: 3,
      selected_contacts: 3,
      total_amount_due: 285.50,
      created_by: adminId,
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Past Due Q1 Review',
      status: 'completed',
      total_contacts: 2,
      selected_contacts: 2,
      total_amount_due: 210.00,
      created_by: adminId,
    },
    {
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Fall Checkup Reminders',
      status: 'draft',
      total_contacts: 0,
      selected_contacts: 0,
      total_amount_due: 0.00,
      created_by: adminId,
    }
  ];

  for (const c of campaigns) {
    await client.query(`
      INSERT INTO campaigns (id, clinic_id, name, status, total_contacts, selected_contacts, total_amount_due, created_by)
      VALUES ('${c.id}', '${clinicId}', '${c.name}', '${c.status}', ${c.total_contacts}, ${c.selected_contacts}, ${c.total_amount_due}, '${c.created_by}')
    `);
  }

  console.log('Seeding contacts...');
  // Contacts for Campaign 1 (July 2026 Collection Drive)
  const contactsC1 = [
    { id: 'c1111111-1111-1111-1111-111111111111', name: 'Eleanor Rigby', phone: '+919999999991', amount: 125.0, context: 'consultation_fee', is_selected: true },
    { id: 'c1111111-2222-2222-2222-222222222222', name: 'Desmond Jones', phone: '+919999999992', amount: 45.0, context: 'other', is_selected: true },
    { id: 'c1111111-3333-3333-3333-333333333333', name: 'Molly Jones', phone: '+919999999993', amount: 350.75, context: 'lab_charges', is_selected: true },
    { id: 'c1111111-4444-4444-4444-444444444444', name: 'Father McKenzie', phone: '+919999999994', amount: 15.0, context: 'other', is_selected: false },
    { id: 'c1111111-5555-5555-5555-555555555555', name: 'Lucy Sky', phone: '+919999999995', amount: 890.00, context: 'admission_charges', is_selected: true },
  ];

  // Contacts for Campaign 2 (Q2 Wellness Follow-up)
  const contactsC2 = [
    { id: 'c2222222-1111-1111-1111-111111111111', name: 'Jude McCartney', phone: '+919999999996', amount: 75.50, context: 'consultation_fee', is_selected: true },
    { id: 'c2222222-2222-2222-2222-222222222222', name: 'Penny Lane', phone: '+919999999997', amount: 210.00, context: 'pharmacy_bill', is_selected: true },
  ];

  // Contacts for Campaign 3 (Past Due Q1 Review)
  const contactsC3 = [
    { id: 'c3333333-1111-1111-1111-111111111111', name: 'Rita Patel', phone: '+919999999998', amount: 110.00, context: 'lab_charges', is_selected: true },
    { id: 'c3333333-2222-2222-2222-222222222222', name: 'Maxwell Silver', phone: '+919999999999', amount: 100.00, context: 'consultation_fee', is_selected: true },
  ];

  const allContacts = [
    ...contactsC1.map(c => ({ ...c, campaign_id: '11111111-1111-1111-1111-111111111111' })),
    ...contactsC2.map(c => ({ ...c, campaign_id: '22222222-2222-2222-2222-222222222222' })),
    ...contactsC3.map(c => ({ ...c, campaign_id: '33333333-3333-3333-3333-333333333333' })),
  ];

  for (const c of allContacts) {
    await client.query(`
      INSERT INTO contacts (id, campaign_id, clinic_id, name, phone, amount_due, payment_context, is_selected)
      VALUES ('${c.id}', '${c.campaign_id}', '${clinicId}', '${c.name}', '${c.phone}', ${c.amount}, '${c.context}', ${c.is_selected})
    `);
  }

  console.log('Seeding calls...');
  // Seed some calls
  const calls = [
    {
      id: 'f1111111-1111-1111-1111-111111111111',
      contact_id: 'c1111111-1111-1111-1111-111111111111', // Eleanor
      campaign_id: '11111111-1111-1111-1111-111111111111',
      attempt_number: 1,
      call_status: 'completed',
      outcome: 'paid_now',
      duration_seconds: 165,
      recording_url: 'https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg',
      ai_summary: 'Patient Eleanor Rigby agreed to pay her consultation fee of $125.00. Payment link was sent during the call, and she completed the transaction immediately.',
      sentiment: 'friendly',
      transcript: JSON.stringify([
        { from: 'agent', text: 'Hello, am I speaking with Eleanor Rigby?', at_seconds: 2 },
        { from: 'customer', text: 'Yes, this is Eleanor. Who is calling?', at_seconds: 5 },
        { from: 'agent', text: 'Hi Eleanor, I am calling from Auvia Wellness Center regarding a pending consultation fee of $125 from your visit on June 15th.', at_seconds: 10 },
        { from: 'customer', text: 'Ah, yes. I completely forgot about that invoice. Can I pay it over the phone or online?', at_seconds: 18 },
        { from: 'agent', text: 'I can trigger a secure payment link directly to your mobile phone via SMS or WhatsApp, which you can pay using UPI, card, or net banking.', at_seconds: 25 },
        { from: 'customer', text: 'That would be great, please send it to this number.', at_seconds: 32 },
        { from: 'agent', text: 'Sent! Please check your phone. It should show a link from Razorpay.', at_seconds: 38 },
        { from: 'customer', text: 'Got it, let me complete this... okay, it says payment successful!', at_seconds: 50 },
        { from: 'agent', text: 'Perfect. I see the confirmation on my screen. Thank you, Eleanor. Have a wonderful day!', at_seconds: 56 },
        { from: 'customer', text: 'Thank you, bye!', at_seconds: 60 }
      ])
    },
    {
      id: 'f1111111-2222-2222-2222-222222222222',
      contact_id: 'c1111111-2222-2222-2222-222222222222', // Desmond
      campaign_id: '11111111-1111-1111-1111-111111111111',
      attempt_number: 1,
      call_status: 'not_answered',
      outcome: null,
      duration_seconds: 15,
      recording_url: null,
      ai_summary: 'Dialed Desmond. Call rang but went to voicemail. Left a structured voice message.',
      sentiment: 'neutral',
      transcript: JSON.stringify([])
    },
    {
      id: 'f2222222-1111-1111-1111-111111111111',
      contact_id: 'c2222222-1111-1111-1111-111111111111', // Jude
      campaign_id: '22222222-2222-2222-2222-222222222222',
      attempt_number: 1,
      call_status: 'completed',
      outcome: 'link_sent',
      duration_seconds: 312,
      recording_url: 'https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg',
      ai_summary: 'Spoke with Jude McCartney. He requested details about his bill. Verified his insurance copay. Sent the payment link and he promised to pay tonight.',
      sentiment: 'cooperative',
      transcript: JSON.stringify([
        { from: 'agent', text: 'Hello, this is Auvia Wellness. May I speak to Jude?', at_seconds: 3 },
        { from: 'customer', text: 'Speaking. What is this about?', at_seconds: 6 },
        { from: 'agent', text: 'Jude, we are checking on the copay amount of $75.50 remaining from your session last month.', at_seconds: 12 },
        { from: 'customer', text: 'Oh, okay. Can you send me the invoice via email or WhatsApp so I can pay it tonight?', at_seconds: 22 },
        { from: 'agent', text: 'Absolutely, I am sending a Razorpay link to this number right now.', at_seconds: 28 },
        { from: 'customer', text: 'Okay, I will check it and clear it later today.', at_seconds: 35 }
      ])
    },
    {
      id: 'f2222222-2222-2222-2222-222222222222',
      contact_id: 'c2222222-2222-2222-2222-222222222222', // Penny
      campaign_id: '22222222-2222-2222-2222-222222222222',
      attempt_number: 1,
      call_status: 'failed',
      outcome: null,
      duration_seconds: 4,
      recording_url: null,
      ai_summary: 'Number unreachable or disconnected.',
      sentiment: 'neutral',
      transcript: JSON.stringify([])
    },
    {
      id: 'f3333333-1111-1111-1111-111111111111',
      contact_id: 'c3333333-1111-1111-1111-111111111111', // Rita
      campaign_id: '33333333-3333-3333-3333-333333333333',
      attempt_number: 1,
      call_status: 'completed',
      outcome: 'paid_now',
      duration_seconds: 120,
      recording_url: 'https://actions.google.com/sounds/v1/ambiences/morning_birds.ogg',
      ai_summary: 'Rita paid her $110.00 lab charges immediately via WhatsApp link.',
      sentiment: 'happy',
      transcript: JSON.stringify([])
    }
  ];

  for (const c of calls) {
    await client.query(`
      INSERT INTO calls (id, contact_id, campaign_id, clinic_id, attempt_number, call_status, outcome, duration_seconds, recording_url, ai_summary, sentiment, transcript)
      VALUES ('${c.id}', '${c.contact_id}', '${c.campaign_id}', '${clinicId}', ${c.attempt_number}, '${c.call_status}', ${c.outcome ? `'${c.outcome}'` : 'null'}, ${c.duration_seconds}, ${c.recording_url ? `'${c.recording_url}'` : 'null'}, ${c.ai_summary ? `'${c.ai_summary}'` : 'null'}, ${c.sentiment ? `'${c.sentiment}'` : 'null'}, ${c.transcript ? `'${c.transcript}'` : 'null'})
    `);
  }

  console.log('Seeding payment links and payments...');
  // Seed some payments
  // Eleanor's payment link and payment
  await client.query(`
    INSERT INTO payment_links (id, call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at, paid_at)
    VALUES (
      'd1111111-1111-1111-1111-111111111111',
      'f1111111-1111-1111-1111-111111111111',
      'c1111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111',
      '${clinicId}',
      'plink_eleanor123',
      'https://rzp.io/i/eleanor',
      125.00,
      'paid',
      'sms',
      now() - interval '2 hours',
      now() - interval '1 hour 50 minutes'
    )
  `);

  await client.query(`
    INSERT INTO payments (id, payment_link_id, contact_id, clinic_id, razorpay_payment_id, amount_paid, method, paid_at)
    VALUES (
      'e1111111-1111-1111-1111-111111111111',
      'd1111111-1111-1111-1111-111111111111',
      'c1111111-1111-1111-1111-111111111111',
      '${clinicId}',
      'pay_eleanor_txn_123',
      125.00,
      'upi',
      now() - interval '1 hour 50 minutes'
    )
  `);

  // Jude's payment link (sent but unpaid)
  await client.query(`
    INSERT INTO payment_links (id, call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at)
    VALUES (
      'd2222222-2222-2222-2222-222222222222',
      'f2222222-1111-1111-1111-111111111111',
      'c2222222-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '${clinicId}',
      'plink_jude123',
      'https://rzp.io/i/jude',
      75.50,
      'sent',
      'whatsapp',
      now() - interval '1 hour'
    )
  `);

  // Rita's payment link and payment
  await client.query(`
    INSERT INTO payment_links (id, call_id, contact_id, campaign_id, clinic_id, razorpay_link_id, short_url, amount, status, sent_via, sent_at, paid_at)
    VALUES (
      'd3333333-3333-3333-3333-333333333333',
      'f3333333-1111-1111-1111-111111111111',
      'c3333333-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
      '${clinicId}',
      'plink_rita123',
      'https://rzp.io/i/rita',
      110.00,
      'paid',
      'whatsapp',
      now() - interval '1 day',
      now() - interval '23 hours 50 minutes'
    )
  `);

  await client.query(`
    INSERT INTO payments (id, payment_link_id, contact_id, clinic_id, razorpay_payment_id, amount_paid, method, paid_at)
    VALUES (
      'e3333333-3333-3333-3333-333333333333',
      'd3333333-3333-3333-3333-333333333333',
      'c3333333-1111-1111-1111-111111111111',
      '${clinicId}',
      'pay_rita_txn_123',
      110.00,
      'card',
      now() - interval '23 hours 50 minutes'
    )
  `);

  // Update audit log
  await client.query(`
    INSERT INTO audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES ('${clinicId}', '${adminId}', 'campaign.created', 'campaign', '11111111-1111-1111-1111-111111111111', '{"campaign_name": "July 2026 Collection Drive"}'::jsonb)
  `);

  console.log('Database successfully bootstrapped and seeded with mock data!');
} catch (err) {
  console.error('Error bootstrapping database:', err);
  process.exit(1);
} finally {
  await client.end();
}
