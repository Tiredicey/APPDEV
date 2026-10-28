export type Profile = {
  dob: string
  phone: string
  address: string
  filipino: boolean
  level: 'SHS' | 'College'
  jhsType?: 'public' | 'esc' | 'private'
  priorDegree?: boolean
  pwd?: boolean
  householdIncome?: number
  listahanan?: boolean
  soloParentDependent?: boolean
  indigenous?: boolean
  otherGovGrant?: boolean
}

export type Match = { code: string; name: string; amount: string; basis: string; documents: string[]; caveat: string; source: string }

const UNIFAST = 'https://unifast.gov.ph/tes.html'
const VOUCHER = 'https://depedroxi.ph/voucher-program/'

export function screen(p: Profile): Match[] {
  const out: Match[] = []
  if (!p.filipino) return out
  if (p.level === 'College' && !p.priorDegree) {
    const priority = p.listahanan ? 'Priority 1 (Listahanan or 4Ps household)' : p.soloParentDependent || p.indigenous || p.pwd ? 'Priority 2 (solo-parent dependent, IP or PWD)' : 'No stated priority group'
    out.push({
      code: 'TES',
      name: 'Tertiary Education Subsidy (private HEI)',
      amount: 'P27,000 per academic year',
      basis: `Filipino, no previous undergraduate degree. ${priority}.`,
      documents: ['Certificate of Registration/Enrollment', 'Certificate of Residency (private HEI without SUC/LUC category)', 'PWD ID (if applicable)'],
      caveat: 'Subject to prioritization and availability of funds; retention and non-overstaying rules apply.',
      source: UNIFAST
    })
    if (p.pwd) out.push({
      code: 'TES3A',
      name: 'TES-3A Person with Disability add-on',
      amount: 'P10,000 per academic year',
      basis: 'Applicant declared a disability.',
      documents: ['PWD ID'],
      caveat: 'Add-on to TES; same prioritization and fund limits.',
      source: UNIFAST
    })
    if (typeof p.householdIncome === 'number' && p.householdIncome <= 400000 && !p.otherGovGrant) out.push({
      code: 'TDP',
      name: 'Tulong Dunong Program',
      amount: 'P7,500 per regular semester',
      basis: `Household gross income P${p.householdIncome.toLocaleString('en-PH')} is within the P400,000 ceiling; first undergraduate degree; no other national government grant declared.`,
      documents: ['TDP-TES Application Form', 'Certificate of Enrolment or Registration with number of units', 'Certificate of Indigency signed by the Punong Barangay'],
      caveat: 'Cannot be held together with TES, CHED scholarships or other national StuFAPs; subject to funds.',
      source: UNIFAST
    })
  }
  if (p.level === 'SHS' && p.jhsType) {
    const t = {
      public: { amount: 'P17,500 (100% tier)', basis: 'Public JHS completers are automatically qualified.', docs: ['Learner Reference Number (pre-identified in LIS)'] },
      esc: { amount: 'P14,000 (80% tier)', basis: 'ESC grantees from a private JHS are automatically qualified.', docs: ['Learner Reference Number', 'ESC grantee record'] },
      private: { amount: 'P14,000 (80% tier) if approved', basis: 'Private JHS non-ESC completers must apply through OVAP and be approved.', docs: ['OVAP application form and confirmation slip', 'PSA Birth Certificate', '2 copies 2x2 ID photo', 'Latest Grade 10 report card', 'Latest ITR of parents/guardian or certificate of tax exemption or unemployment', 'Certificate of Employment (if parent/guardian is employed)'] }
    }[p.jhsType]
    out.push({
      code: 'SHSVP',
      name: 'DepEd Senior High School Voucher',
      amount: t.amount,
      basis: `${t.basis} Lipa City is a component city outside NCR and not a highly urbanized city, so the lowest location tier applies.`,
      documents: t.docs,
      caveat: 'Tier amounts are from DepEd guidelines first published for SY 2016-2017; confirm the current amount on the live OVAP portal before quoting.',
      source: VOUCHER
    })
  }
  return out
}
