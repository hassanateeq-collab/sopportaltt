/**
 * Seed content for the portal.
 *
 * This is demonstration data, not Hamsun's real staff list or real procedures.
 * It exists so every screen has something truthful-looking to render before the
 * Supabase backend is wired up. Replace it wholesale at go-live.
 *
 * Note the SOP scopes: most are { kind: 'ALL' }, which means DHA — still
 * pre-opening — already inherits them, and will keep inheriting anything
 * published group-wide between now and the day it opens. That inheritance is
 * derived, never assigned.
 */

import type { Branch, Department, Manager, Admin, Sop, Staff, Test, Question, Admin as AdminType } from '../types'

export const BRANCHES: Branch[] = [
  { id: 'br-fsl', code: 'FSL', name: 'Shahrah-e-Faisal', status: 'open' },
  { id: 'br-ext', code: 'EXT', name: 'Extension', status: 'open' },
  { id: 'br-clf', code: 'CLF', name: 'Clifton', status: 'open' },
  { id: 'br-dha', code: 'DHA', name: 'DHA', status: 'pre_opening' },
]

export const DEPARTMENTS: Department[] = [
  { id: 'dp-fd', code: 'FD', name: 'Front Desk' },
  { id: 'dp-hk', code: 'HK', name: 'Housekeeping' },
  { id: 'dp-kt', code: 'KT', name: 'Kitchen' },
  { id: 'dp-mt', code: 'MT', name: 'Maintenance' },
  { id: 'dp-qc', code: 'QC', name: 'Quality & Compliance' },
]

/**
 * Demo employee codes, in plaintext, for this build only.
 *
 * The store hashes each of these at first boot and keeps only the hash, exactly
 * as it will do for real staff. They are listed here so the demo is usable; the
 * moment real people are added this constant goes away and codes are generated
 * one at a time by an admin and shown once.
 */
export const DEMO_STAFF: Array<Omit<Staff, 'employee_code_hash' | 'created_at'> & { code: string }> = [
  // Shahrah-e-Faisal
  { id: 'st-01', name: 'Ayesha Siddiqui', department_id: 'dp-fd', branch_id: 'br-fsl', job_title: 'Front Desk Agent', active: true, code: '481902' },
  { id: 'st-02', name: 'Bilal Ahmed', department_id: 'dp-fd', branch_id: 'br-fsl', job_title: 'Night Auditor', active: true, code: '730514' },
  { id: 'st-03', name: 'Nadia Kamal', department_id: 'dp-hk', branch_id: 'br-fsl', job_title: 'Room Attendant', active: true, code: '295637' },
  { id: 'st-04', name: 'Imran Yousuf', department_id: 'dp-kt', branch_id: 'br-fsl', job_title: 'Commis Chef', active: true, code: '648120' },
  { id: 'st-05', name: 'Rashid Mehmood', department_id: 'dp-mt', branch_id: 'br-fsl', job_title: 'Maintenance Technician', active: true, code: '517483' },

  // Extension
  { id: 'st-06', name: 'Sana Tariq', department_id: 'dp-fd', branch_id: 'br-ext', job_title: 'Front Desk Agent', active: true, code: '362095' },
  { id: 'st-07', name: 'Farhan Ali', department_id: 'dp-hk', branch_id: 'br-ext', job_title: 'Room Attendant', active: true, code: '904271' },
  { id: 'st-08', name: 'Zubair Hassan', department_id: 'dp-kt', branch_id: 'br-ext', job_title: 'Kitchen Steward', active: true, code: '183746' },

  // Clifton
  { id: 'st-09', name: 'Hina Raza', department_id: 'dp-fd', branch_id: 'br-clf', job_title: 'Guest Relations', active: true, code: '572038' },
  { id: 'st-10', name: 'Salma Bibi', department_id: 'dp-hk', branch_id: 'br-clf', job_title: 'Room Attendant', active: true, code: '640917' },
  { id: 'st-11', name: 'Kiran Shah', department_id: 'dp-hk', branch_id: 'br-clf', job_title: 'Room Attendant', active: true, code: '218563' },
  { id: 'st-12', name: 'Asif Nawaz', department_id: 'dp-hk', branch_id: 'br-clf', job_title: 'Housekeeping Supervisor', active: true, code: '795402' },
  { id: 'st-13', name: 'Waqas Idrees', department_id: 'dp-kt', branch_id: 'br-clf', job_title: 'Line Cook', active: true, code: '306814' },
  { id: 'st-14', name: 'Tahir Jameel', department_id: 'dp-qc', branch_id: 'br-clf', job_title: 'Compliance Officer', active: true, code: '459173' },
]

export const MANAGERS: Manager[] = [
  { id: 'mg-01', name: 'Mehreen Qadir', email: 'mehreen.kitchen.fsl@hamsun.example', department_id: 'dp-kt', branch_id: 'br-fsl', active: true, role: 'manager' },
  { id: 'mg-02', name: 'Owais Bhatti', email: 'owais.housekeeping.clf@hamsun.example', department_id: 'dp-hk', branch_id: 'br-clf', active: true, role: 'manager' },
  { id: 'mg-03', name: 'Rabia Noor', email: 'rabia.frontdesk.fsl@hamsun.example', department_id: 'dp-fd', branch_id: 'br-fsl', active: true, role: 'manager' },
  { id: 'mg-04', name: 'Junaid Farooq', email: 'junaid.branch.fsl@hamsun.example', department_id: null, branch_id: 'br-fsl', active: true, role: 'branch_manager' },
  { id: 'mg-05', name: 'Sadia Iqbal', email: 'sadia.hr@hamsun.example', department_id: null, branch_id: null, active: true, role: 'hr' },
  { id: 'mg-06', name: 'Hamsun Group CEO', email: 'ceo@hamsun.example', department_id: null, branch_id: null, active: true, role: 'ceo' },
]

export const ADMINS: AdminType[] = [
  { id: 'ad-01', name: 'Hamsun Group Admin', email: 'admin@hamsun.example' },
]

/** Demo passwords for the manager/admin sign-in. Supabase Auth replaces this entirely. */
export const DEMO_PASSWORDS: Record<string, string> = {
  'mehreen.kitchen.fsl@hamsun.example': 'kitchen123',
  'owais.housekeeping.clf@hamsun.example': 'housekeeping123',
  'rabia.frontdesk.fsl@hamsun.example': 'frontdesk123',
  'admin@hamsun.example': 'admin123',
  'junaid.branch.fsl@hamsun.example': 'branch123',
  'sadia.hr@hamsun.example': 'hr123',
  'ceo@hamsun.example': 'ceo123',
}

const NOW = '2026-07-01T09:00:00.000Z'

export const SOPS: Sop[] = [
  {
    id: 'sop-fd-001',
    code: 'FD-001',
    title: 'Guest Check-In and Registration',
    summary:
      'How to receive an arriving guest, verify identity against CNIC or passport, complete the registration card, take the security deposit, and hand over keys within the four-minute target.',
    department_id: 'dp-fd',
    branch_scope: { kind: 'ALL' },
    version: 3,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-06-12T10:20:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-fd-002',
    code: 'FD-002',
    title: 'Handling Guest Complaints and Escalation',
    summary:
      'The listen-acknowledge-act sequence, what a front desk agent may resolve alone, the compensation ceiling before a manager must be called, and how the complaint is logged so it reaches Quality & Compliance.',
    department_id: 'dp-fd',
    branch_scope: { kind: 'ALL' },
    version: 2,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-05-28T14:05:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-fd-003',
    code: 'FD-003',
    title: 'Cash Handling and Shift Close at Front Desk',
    summary:
      'Float count at shift start, cash drop thresholds during the shift, reconciliation against the PMS at shift close, and the two-signature rule on any variance above PKR 500.',
    department_id: 'dp-fd',
    branch_scope: { kind: 'LIST', branch_codes: ['FSL', 'EXT'] },
    version: 1,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-04-02T08:45:00.000Z',
    published_by: 'Rabia Noor',
  },
  {
    id: 'sop-hk-001',
    code: 'HK-001',
    title: 'Standard Room Cleaning and Presentation',
    summary:
      'The room-standard sequence from door to door: strip, dust high-to-low, bathroom set, bed set to the Hamsun fold, amenity placement, final walk-through and the checklist that must be signed before the room is released.',
    department_id: 'dp-hk',
    branch_scope: { kind: 'ALL' },
    version: 4,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-06-25T07:30:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-hk-002',
    code: 'HK-002',
    title: 'Linen Handling and Laundry Cycle',
    summary:
      'Segregating soiled from stained linen, the sixty-degree wash rule for bed linen, par-stock levels per floor, and how condemned linen is recorded rather than quietly discarded.',
    department_id: 'dp-hk',
    branch_scope: { kind: 'ALL' },
    version: 1,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-03-14T11:00:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-kt-001',
    code: 'KT-001',
    title: 'Food Safety, Temperature Control and Storage',
    summary:
      'Cold chain from delivery to service: acceptance temperatures, the danger zone, FIFO rotation and labelling, separation of raw and ready-to-eat, and the twice-daily fridge log every kitchen member is responsible for.',
    department_id: 'dp-kt',
    branch_scope: { kind: 'ALL' },
    version: 2,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-06-30T06:15:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-kt-002',
    code: 'KT-002',
    title: 'Breakfast Service Line Setup',
    summary:
      'Opening the buffet line: hot-holding equipment brought to temperature before food is placed, sneeze-guard positioning, replenishment in small batches, and the two-hour rule on any item left on the line.',
    department_id: 'dp-kt',
    branch_scope: { kind: 'LIST', branch_codes: ['FSL', 'CLF'] },
    version: 1,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-02-19T05:40:00.000Z',
    published_by: 'Mehreen Qadir',
  },
  {
    id: 'sop-mt-001',
    code: 'MT-001',
    title: 'Preventive Maintenance Rounds and Logging',
    summary:
      'The daily and weekly round sheets, which readings are taken where, what constitutes a fault that stops a room from being sold, and how a job is raised so it appears on the maintenance portal.',
    department_id: 'dp-mt',
    branch_scope: { kind: 'ALL' },
    version: 1,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-01-22T09:10:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
  {
    id: 'sop-qc-001',
    code: 'QC-001',
    title: 'Incident Reporting and Root-Cause Follow-Up',
    summary:
      'What counts as a reportable incident, the twenty-four-hour reporting window, how an incident cites the specific SOP breached by its document-control code, and who owns the corrective action.',
    department_id: 'dp-qc',
    branch_scope: { kind: 'ALL' },
    version: 1,
    document_file_id: null,
    video_file_id: null,
    approval_status: 'authorized',
    updated_at: '2026-05-09T12:00:00.000Z',
    published_by: 'Hamsun Group Admin',
  },
]

export const TESTS: Test[] = [
  {
    id: 'ts-kt-food',
    title: 'Food Safety Certification',
    department_id: 'dp-kt',
    branch_scope: { kind: 'ALL' },
    related_sop_id: 'sop-kt-001',
    pass_mark: 80,
    validity_months: 12,
    languages: ['en', 'ur', 'ps'],
    status: 'published',
    created_at: NOW,
  },
  {
    id: 'ts-hk-room',
    title: 'Room Standard Assessment',
    department_id: 'dp-hk',
    branch_scope: { kind: 'ALL' },
    related_sop_id: 'sop-hk-001',
    pass_mark: 70,
    validity_months: 6,
    languages: ['en', 'ur'],
    status: 'published',
    created_at: NOW,
  },
  {
    id: 'ts-fd-complaint',
    title: 'Complaint Handling and Escalation',
    department_id: 'dp-fd',
    branch_scope: { kind: 'ALL' },
    related_sop_id: 'sop-fd-002',
    pass_mark: 75,
    validity_months: 12,
    languages: ['en'],
    status: 'published',
    created_at: NOW,
  },
]

/**
 * Seed questions.
 *
 * The Urdu and Pashto strings here stand in for what the translate-test Edge
 * Function will produce from the English original. They are renderings of the
 * English, and if the English changes they are regenerated rather than patched —
 * otherwise you end up certifying people against three subtly different tests.
 * Scoring is by option position, so it is identical in every language.
 */
export const QUESTIONS: Question[] = [
  // ---- Food Safety Certification (KT-001) ----
  {
    id: 'q-kt-1',
    test_id: 'ts-kt-food',
    position: 1,
    text: 'Chilled goods arrive at the back door. Above what temperature must you refuse the delivery?',
    options: ['2°C', '5°C', '8°C', '12°C'],
    correct_index: 2,
    translations: {
      ur: {
        text: 'ٹھنڈا سامان پچھلے دروازے پر پہنچتا ہے۔ کس درجہ حرارت سے اوپر آپ کو ڈیلیوری واپس کرنی چاہیے؟',
        options: ['2°C', '5°C', '8°C', '12°C'],
      },
      ps: {
        text: 'یخ توکي شاتنۍ دروازې ته راځي. د کوم تودوخې درجې نه پورته باید تحویلي ونه منئ؟',
        options: ['2°C', '5°C', '8°C', '12°C'],
      },
    },
    audio: {},
  },
  {
    id: 'q-kt-2',
    test_id: 'ts-kt-food',
    position: 2,
    text: 'Raw chicken and washed salad leaves are the only two items left needing fridge space. What do you do?',
    options: [
      'Put the chicken on the shelf above the salad',
      'Put the chicken on the shelf below the salad',
      'Put both on the same shelf with a gap between them',
      'Leave the salad out until the chicken is used',
    ],
    correct_index: 1,
    translations: {
      ur: {
        text: 'کچا مرغی اور دھلے ہوئے سلاد کے پتے صرف دو چیزیں باقی ہیں جنہیں فریج میں جگہ چاہیے۔ آپ کیا کریں گے؟',
        options: [
          'مرغی کو سلاد کے اوپر والے خانے میں رکھیں',
          'مرغی کو سلاد کے نیچے والے خانے میں رکھیں',
          'دونوں کو ایک ہی خانے میں فاصلے کے ساتھ رکھیں',
          'مرغی استعمال ہونے تک سلاد کو باہر چھوڑ دیں',
        ],
      },
      ps: {
        text: 'اوم چرګ او مینځل شوي د سالادو پاڼې یوازې دوه شیان دي چې د یخچال ځای ته اړتیا لري. تاسو به څه وکړئ؟',
        options: [
          'چرګ د سالادو نه پورته الماري کې کېږدئ',
          'چرګ د سالادو نه لاندې الماري کې کېږدئ',
          'دواړه په یوه الماري کې د واټن سره کېږدئ',
          'تر څو چې چرګ استعمال شي سالاد بهر پرېږدئ',
        ],
      },
    },
    audio: {},
  },
  {
    id: 'q-kt-3',
    test_id: 'ts-kt-food',
    position: 3,
    text: 'How often must the fridge temperature log be completed?',
    options: ['Once a week', 'Once a day', 'Twice a day', 'Only when a fault is noticed'],
    correct_index: 2,
    translations: {
      ur: {
        text: 'فریج کے درجہ حرارت کا ریکارڈ کتنی بار مکمل کرنا ضروری ہے؟',
        options: ['ہفتے میں ایک بار', 'دن میں ایک بار', 'دن میں دو بار', 'صرف جب خرابی نظر آئے'],
      },
      ps: {
        text: 'د یخچال د تودوخې ثبت باید څو ځله بشپړ شي؟',
        options: ['په اونۍ کې یو ځل', 'په ورځ کې یو ځل', 'په ورځ کې دوه ځله', 'یوازې کله چې خرابي ولیدل شي'],
      },
    },
    audio: {},
  },
  {
    id: 'q-kt-4',
    test_id: 'ts-kt-food',
    position: 4,
    text: 'You find an unlabelled container of cooked rice in the walk-in. Nobody remembers when it was made. What is the correct action?',
    options: [
      'Label it with today’s date and keep it',
      'Smell it, and keep it if it seems fine',
      'Discard it and record the waste',
      'Reheat it thoroughly and serve it today',
    ],
    correct_index: 2,
    translations: {
      ur: {
        text: 'آپ کو واک اِن میں پکے ہوئے چاول کا بغیر لیبل ڈبہ ملتا ہے۔ کسی کو یاد نہیں کہ یہ کب بنایا گیا۔ درست عمل کیا ہے؟',
        options: [
          'آج کی تاریخ کا لیبل لگا کر رکھ لیں',
          'سونگھ کر دیکھیں، ٹھیک لگے تو رکھ لیں',
          'ضائع کر دیں اور ضیاع کا اندراج کریں',
          'اچھی طرح گرم کر کے آج ہی پیش کر دیں',
        ],
      },
      ps: {
        text: 'تاسو په یخچال کې د پخو وریجو یو بې نښې لوښی ومومئ. هیچا ته نه یادیږي چې کله جوړ شوی. سم کار څه دی؟',
        options: [
          'د نن ورځې نېټه پرې ولیکئ او وساتئ',
          'بوی یې واخلئ، که سم ښکاري وساتئ',
          'وګرځوئ یې او د ضایع ثبت وکړئ',
          'ښه یې تود کړئ او نن یې وړاندې کړئ',
        ],
      },
    },
    audio: {},
  },

  // ---- Room Standard Assessment (HK-001) ----
  {
    id: 'q-hk-1',
    test_id: 'ts-hk-room',
    position: 1,
    text: 'In what order is a departure room cleaned?',
    options: [
      'Bathroom first, then strip the bed, then dust',
      'Strip the bed, dust high to low, then bathroom',
      'Dust low to high, bathroom, then strip the bed',
      'Any order, as long as the checklist is signed',
    ],
    correct_index: 1,
    translations: {
      ur: {
        text: 'مہمان کے جانے کے بعد کمرہ کس ترتیب سے صاف کیا جاتا ہے؟',
        options: [
          'پہلے باتھ روم، پھر بستر اتاریں، پھر جھاڑ پونچھ',
          'بستر اتاریں، اوپر سے نیچے جھاڑ پونچھ، پھر باتھ روم',
          'نیچے سے اوپر جھاڑ پونچھ، باتھ روم، پھر بستر اتاریں',
          'کوئی بھی ترتیب، بس چیک لسٹ پر دستخط ہوں',
        ],
      },
    },
    audio: {},
  },
  {
    id: 'q-hk-2',
    test_id: 'ts-hk-room',
    position: 2,
    text: 'You are mid-clean and notice the bedsheet has a stain that will not come out. What do you do?',
    options: [
      'Fold the stain under the mattress so it does not show',
      'Replace it and send the sheet for stain treatment, recording it',
      'Replace it and put the sheet straight in the normal wash',
      'Leave it and tell the next shift',
    ],
    correct_index: 1,
    translations: {
      ur: {
        text: 'صفائی کے دوران آپ دیکھتے ہیں کہ چادر پر ایسا داغ ہے جو نہیں جا رہا۔ آپ کیا کریں گے؟',
        options: [
          'داغ کو گدے کے نیچے دبا دیں تاکہ نظر نہ آئے',
          'چادر بدلیں اور داغ کے علاج کے لیے بھیجیں، اندراج کے ساتھ',
          'چادر بدلیں اور سیدھا عام دھلائی میں ڈال دیں',
          'رہنے دیں اور اگلی شفٹ کو بتا دیں',
        ],
      },
    },
    audio: {},
  },
  {
    id: 'q-hk-3',
    test_id: 'ts-hk-room',
    position: 3,
    text: 'When may a room be released as ready to sell?',
    options: [
      'As soon as the bed is made',
      'After the final walk-through and the signed checklist',
      'When the supervisor is too busy to inspect',
      'At the end of the shift regardless',
    ],
    correct_index: 1,
    translations: {
      ur: {
        text: 'کمرہ کب فروخت کے لیے تیار قرار دیا جا سکتا ہے؟',
        options: [
          'جیسے ہی بستر بن جائے',
          'آخری معائنے اور دستخط شدہ چیک لسٹ کے بعد',
          'جب سپروائزر معائنے کے لیے مصروف ہو',
          'شفٹ کے آخر میں، ہر حال میں',
        ],
      },
    },
    audio: {},
  },

  // ---- Complaint Handling (FD-002) ----
  {
    id: 'q-fd-1',
    test_id: 'ts-fd-complaint',
    position: 1,
    text: 'A guest complains at 23:00 that their room is noisy. What is the first thing you do?',
    options: [
      'Offer a discount straight away',
      'Listen fully and acknowledge before proposing anything',
      'Explain that the hotel is full',
      'Ask them to put it in writing in the morning',
    ],
    correct_index: 1,
    translations: {},
    audio: {},
  },
  {
    id: 'q-fd-2',
    test_id: 'ts-fd-complaint',
    position: 2,
    text: 'Above what point must a front desk agent call the duty manager rather than resolve a complaint alone?',
    options: [
      'Any complaint at all',
      'Once compensation would exceed the agent’s stated ceiling',
      'Only if the guest asks for a manager',
      'Only for complaints about billing',
    ],
    correct_index: 1,
    translations: {},
    audio: {},
  },
  {
    id: 'q-fd-3',
    test_id: 'ts-fd-complaint',
    position: 3,
    text: 'Where must a resolved complaint end up?',
    options: [
      'Nowhere, if the guest is satisfied',
      'In the shift handover note only',
      'Logged so it reaches Quality & Compliance',
      'On the noticeboard for other staff to read',
    ],
    correct_index: 2,
    translations: {},
    audio: {},
  },
]

export const SEED_ADMINS: Admin[] = ADMINS
