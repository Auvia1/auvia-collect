export const campaigns = [
  {
    id: 'jul-2026',
    name: 'July 2026 Collection Drive',
    createdDate: 'Jun 15, 2026',
    contacts: 1240,
    status: 'active',
    collectionPercent: 68,
  },
  {
    id: 'q2-wellness',
    name: 'Q2 Wellness Follow-up',
    createdDate: 'Apr 02, 2026',
    contacts: 3500,
    status: 'active',
    collectionPercent: 42,
  },
  {
    id: 'q1-review',
    name: 'Past Due Q1 Review',
    createdDate: 'Jan 10, 2026',
    contacts: 850,
    status: 'completed',
    collectionPercent: 100,
  },
  {
    id: 'fall-checkup',
    name: 'Fall Checkup Reminders',
    createdDate: 'Aug 01, 2026',
    contacts: null,
    status: 'draft',
    collectionPercent: 25,
  },
]

export const contacts = [
  { id: 1, name: 'Eleanor Rigby', phone: '(555) 123-4567', amount: 125.0, context: 'Annual Wellness Visit', selected: true },
  { id: 2, name: 'Desmond Jones', phone: '(555) 987-6543', amount: 45.0, context: 'Copay', selected: true },
  { id: 3, name: 'Molly Jones', phone: '(555) 246-8101', amount: 350.75, context: 'Lab Fees', selected: true },
  { id: 4, name: 'Father McKenzie', phone: '(555) 369-2580', amount: 15.0, context: 'Copay', selected: false },
  { id: 5, name: 'Lucy Sky', phone: '(555) 867-5309', amount: 890.0, context: 'Imaging', selected: true },
]

export const callLog = [
  {
    id: 'eleanor-rigby',
    name: 'Eleanor Rigby',
    phone: '(555) 123-4567',
    amount: 125.0,
    campaignId: 'jul-2026',
    campaignName: 'July 2026 Collection Drive',
    callStatus: 'Completed',
    paymentStatus: 'Paid',
    duration: '2m 45s',
    summary: 'Customer agreed to pay, link sent, payment completed',
    hasRecording: true,
  },
  {
    id: 'desmond-jones',
    name: 'Desmond Jones',
    phone: '(555) 987-6543',
    amount: 450.0,
    campaignId: 'jul-2026',
    campaignName: 'July 2026 Collection Drive',
    callStatus: 'Not Answered',
    paymentStatus: 'Unpaid',
    duration: '0m 15s',
    summary: 'Voicemail reached, message left.',
    hasRecording: false,
  },
  {
    id: 'jude-mccartney',
    name: 'Jude McCartney',
    phone: '(555) 333-2222',
    amount: 75.5,
    campaignId: 'q2-wellness',
    campaignName: 'Q2 Wellness Follow-up',
    callStatus: 'Completed',
    paymentStatus: 'Payment Link Sent',
    duration: '5m 12s',
    summary: 'Discussed payment options, link sent via SMS.',
    hasRecording: true,
  },
  {
    id: 'penny-lane',
    name: 'Penny Lane',
    phone: '(555) 444-5555',
    amount: 210.0,
    campaignId: 'q2-wellness',
    campaignName: 'Q2 Wellness Follow-up',
    callStatus: 'Failed',
    paymentStatus: 'Unpaid',
    duration: '0m 04s',
    summary: 'Number disconnected or unreachable.',
    hasRecording: false,
  },
  {
    id: 'rita-patel',
    name: 'Rita Patel',
    phone: '(555) 221-9090',
    amount: 320.0,
    campaignId: 'q1-review',
    campaignName: 'Past Due Q1 Review',
    callStatus: 'Completed',
    paymentStatus: 'Paid',
    duration: '3m 02s',
    summary: 'Customer paid in full over the phone.',
    hasRecording: true,
  },
]

export const callbackQueue = [
  { id: 1, name: 'Rita Patel', phone: '(555) 221-9090', amount: 320.0, callbackDate: 'Today', callbackTime: '2:00 PM', originalCallDate: 'Jul 3, 2026', overdue: false },
  { id: 2, name: 'Suresh Kumar', phone: '(555) 771-4432', amount: 90.0, callbackDate: 'Today', callbackTime: '11:00 AM', originalCallDate: 'Jul 2, 2026', overdue: true },
  { id: 3, name: 'Anita Rao', phone: '(555) 552-1120', amount: 540.0, callbackDate: 'Jul 6, 2026', callbackTime: '4:30 PM', originalCallDate: 'Jul 4, 2026', overdue: false },
]

export const recentActivity = [
  { name: 'Eleanor Rigby', account: '#8849-2A', status: 'Completed', outcome: 'Success', outcomeVariant: 'secondary' },
  { name: 'Desmond Jones', account: '#9921-5B', status: 'In Progress', outcome: 'Calling...', outcomeVariant: 'primary' },
  { name: 'Molly Jones', account: '#1104-9C', status: 'Failed', outcome: 'No Answer', outcomeVariant: 'tertiary' },
  { name: 'Father McKenzie', account: '#3342-8D', status: 'Completed', outcome: 'Payment Promised', outcomeVariant: 'secondary' },
]

export const teamMembers = [
  { id: 1, name: 'Sarah Jenkins', email: 'sarah@hospital.com', role: 'Admin', status: 'active', lastActive: 'Today' },
  { id: 2, name: 'Ravi Teja', email: 'ravi@hospital.com', role: 'Staff', status: 'active', lastActive: 'Yesterday' },
  { id: 3, name: 'Priya Nair', email: 'priya@hospital.com', role: 'Staff', status: 'invited', lastActive: '—' },
]
