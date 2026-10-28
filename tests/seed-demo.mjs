const BASE = process.env.BASE || 'http://localhost:3000'
const PW = 'demo-password-2026'
class A {
  constructor() { this.c = '' }
  async r(m, p, b) {
    const res = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', 'x-admit': '1', cookie: this.c }, body: b ? JSON.stringify(b) : undefined })
    const s = res.headers.get('set-cookie'); if (s) this.c = s.split(';')[0]
    const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`${p}: ${d.error}`); return d
  }
}
const admin = new A()
await admin.r('POST', '/api/setup', { name: 'Demo Administrator', email: 'admin@demo.local', password: PW })
const ids = {}
for (const [role, name] of [['officer', 'Demo Officer'], ['registrar', 'Demo Registrar'], ['cashier', 'Demo Cashier'], ['finaid', 'Demo Aid Coordinator'], ['dpo', 'Demo DPO']]) ids[role] = (await admin.r('POST', '/api/users', { name, email: `${role}@demo.local`, password: PW, role })).id
const login = async (role) => { const a = new A(); await a.r('POST', '/api/auth/login', { email: `${role}@demo.local`, password: PW }); return a }
const people = [
  ['Maria', 'Santos', '2007-03-11', 'College', 'BS Information Technology', { householdIncome: 240000, pwd: false, listahanan: true }],
  ['Paolo', 'Reyes', '2008-07-22', 'College', 'BS Hospitality Management', { householdIncome: 520000 }],
  ['Andrea', 'Mendoza', '2009-01-05', 'SHS', 'STEM', { jhsType: 'public' }],
  ['Joshua', 'Villanueva', '2007-11-30', 'College', 'BS Computer Engineering', { householdIncome: 180000, pwd: true }]
]
const apps = []
for (const [f, s, dob, level, program, extra] of people) {
  const a = new A()
  await a.r('POST', '/api/auth/register', { first_name: f, surname: s, dob, phone: '09170000000', address: 'Lipa City, Batangas', filipino: true, level, program, email: `${f.toLowerCase()}@demo.local`, password: PW, consent: true, ...extra })
  const me = await a.r('GET', '/api/my'); apps.push({ a, id: me.applicant.id, req: me.requirements, f })
  await a.r('POST', '/api/inquiries', { subject: `${program}: reservation fee and schedule`, message: `Good day! May I ask when the reservation fee for ${program} must be paid and when classes start?`, consent: true })
}
await new A().r('POST', '/api/inquiries', { name: 'Liza Garcia', email: 'liza@demo.local', subject: 'Transferee requirements', message: 'I am transferring from another college. What documents do I need?', consent: true })
const cashier = await login('cashier'), registrar = await login('registrar'), finaid = await login('finaid'), officer = await login('officer')
for (const [i, or] of [[0, 'OR-0001021'], [3, 'OR-0001022']]) {
  await cashier.r('GET', `/api/applicants/${apps[i].id}?purpose=${encodeURIComponent('Validate reservation fee payment')}`)
  await cashier.r('POST', `/api/applicants/${apps[i].id}/payment`, { or_number: or, amount: 1000 })
}
await registrar.r('GET', `/api/applicants/${apps[0].id}?purpose=${encodeURIComponent('Update requirement compliance')}`)
for (const r of apps[0].req.slice(0, 2)) await registrar.r('PATCH', `/api/requirements/${r.id}`, { status: 'received' })
await registrar.r('PATCH', `/api/requirements/${apps[0].req[2].id}`, { status: 'rejected', note: 'Photocopy is unreadable. Please bring the original.' })
await finaid.r('GET', `/api/applicants/${apps[0].id}?purpose=${encodeURIComponent('Screen or endorse financial aid')}`)
await finaid.r('POST', '/api/aid/endorse', { applicant_id: apps[0].id, program_code: 'TES' })
const t = await officer.r('GET', '/api/tickets')
await officer.r('PATCH', `/api/tickets/${t.rows[0].id}`, { assignee_id: ids.officer })
await officer.r('POST', `/api/tickets/${t.rows[0].id}/resolve`, { remark: 'The reservation fee can be paid any time before classes start through apply.sti.edu or at the cashier. The class schedule is released at enrollment.' })
await officer.r('PATCH', `/api/tickets/${t.rows[1].id}`, { assignee_id: ids.officer, tier: 'complex' })
console.log(JSON.stringify({ applicantIds: apps.map((x) => x.id) }))
