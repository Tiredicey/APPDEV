import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE || 'http://localhost:3000'
const results = []
const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'webapp-production', '--local', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const rows = (q) => JSON.parse(sql(q))[0].results

class Agent {
  constructor() { this.cookie = '' }
  async req(method, path, body) {
    const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', 'x-admit': '1', cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data, headers: res.headers }
  }
  get(p) { return this.req('GET', p) }
  post(p, b = {}) { return this.req('POST', p, b) }
  patch(p, b = {}) { return this.req('PATCH', p, b) }
}

function check(id, name, cond, detail = '') {
  results.push({ id, name, pass: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${id.padEnd(7)} ${name}${detail ? '  [' + detail + ']' : ''}`)
}

const stamp = Date.now().toString(36)
const pw = 'correct-horse-battery'

const admin = new Agent()
const setupState = await admin.get('/api/setup')
if (setupState.data.needed) await admin.post('/api/setup', { name: 'Test Administrator', email: `admin-${stamp}@test.local`, password: pw })
else {
  const a = rows("SELECT email FROM users WHERE role='admin' AND name='Test Administrator' LIMIT 1")[0]
  if (!a) throw new Error('An admin exists that this test did not create. Run npm run db:reset first.')
  await admin.post('/api/auth/login', { email: a.email, password: pw })
}
check('SETUP', 'Administrator signed in', (await admin.get('/api/me')).data.user?.role === 'admin')

const staff = {}
for (const role of ['officer', 'registrar', 'cashier', 'finaid', 'dpo']) {
  const email = `${role}-${stamp}@test.local`
  const r = await admin.post('/api/users', { name: `Test ${role}`, email, password: pw, role })
  staff[role] = new Agent()
  await staff[role].post('/api/auth/login', { email, password: pw })
  staff[role].id = r.data.id
}

const anon = new Agent()
const noConsent = await anon.post('/api/inquiries', { name: 'Ana Cruz', email: `ana-${stamp}@test.local`, subject: 'Tuition', message: 'How much is BSIT tuition?' })
check('FR-08', 'Inquiry without consent is refused', noConsent.status === 400)
const inq = await anon.post('/api/inquiries', { name: 'Ana Cruz', email: `ana-${stamp}@test.local`, subject: 'Tuition', message: 'How much is BSIT tuition?', consent: true })
check('FR-01', 'Inquiry returns a unique ticket number in the same session', inq.status === 200 && /^ADM-\d{4}-\d{5}$/.test(inq.data.code), inq.data.code)
const tk = rows(`SELECT id, code FROM tickets WHERE code='${inq.data.code}'`)[0]
check('FR-01', 'Ticket number is stored in the database', !!tk)
const cons = rows(`SELECT statement_text, purpose, created_at FROM consents WHERE ticket_id=${tk.id}`)[0]
check('FR-08', 'Consent text, timestamp and purpose stored for the inquiry', cons && cons.statement_text.length > 50 && cons.purpose && cons.created_at)
const tr = await anon.get(`/api/inquiries/status?code=${inq.data.code}&email=ana-${stamp}@test.local`)
check('FR-01', 'Ticket is trackable by number and email', tr.status === 200 && tr.data.ticket.status === 'open')
const trBad = await anon.get(`/api/inquiries/status?code=${inq.data.code}&email=someone-else@test.local`)
check('FR-05', 'Ticket status hidden from a different email', trBad.status === 404)

const applicantBody = (n, extra = {}) => ({ first_name: `Juan${n}`, surname: `Dela Cruz ${stamp}`, dob: '2008-05-14', phone: '09171234567', address: 'Barangay 6, Lipa City, Batangas', filipino: true, level: 'College', program: 'BS Information Technology', householdIncome: 250000, pwd: true, email: `juan${n}-${stamp}@test.local`, password: pw, consent: true, ...extra })
const ap1 = new Agent()
const reg = await ap1.post('/api/auth/register', applicantBody(1))
check('FR-02', 'Applicant profile created', reg.status === 200)
const codes = (reg.data.matches || []).map((m) => m.code).sort().join(',')
check('FR-04', 'College, PWD, P250k income flags TES, TES-3A and TDP', codes === 'TDP,TES,TES3A', codes)
const dup = await new Agent().post('/api/auth/register', applicantBody(1, { email: `other-${stamp}@test.local` }))
check('FR-02', 'Second profile with same surname, first name and DOB is rejected with a message', dup.status === 409 && /already exists/.test(dup.data.error))

const b400 = screenProbe({ householdIncome: 400000 })
const b401 = screenProbe({ householdIncome: 400001 })
async function screenProbe(extra) { const a = new Agent(); const r = await a.post('/api/auth/register', applicantBody(Math.random().toString(36).slice(2, 7), { pwd: false, ...extra })); return (r.data.matches || []).map((m) => m.code).sort().join(',') }
check('FR-04', 'TDP boundary: P400,000 qualifies', (await b400) === 'TDP,TES', await b400)
check('FR-04', 'TDP boundary: P400,001 does not', (await b401) === 'TES', await b401)
check('FR-04', 'Prior degree removes TES and TDP', (await screenProbe({ priorDegree: true })) === '')
check('FR-04', 'Non-Filipino gets no match', (await screenProbe({ filipino: false })) === '')
check('FR-04', 'SHS public JHS completer flags the voucher', (await screenProbe({ level: 'SHS', jhsType: 'public', program: 'STEM' })) === 'SHSVP')

const my = await ap1.get('/api/my')
const aid = my.data.applicant.id
check('FR-03', 'Applicant sees every required document with a status', my.data.requirements.length === 4 && my.data.requirements.every((r) => ['pending', 'received', 'rejected'].includes(r.status)))
check('FR-05', 'Applicant sees own current stage', my.data.applicant.stage === 'applied')
const ap2 = new Agent()
await ap2.post('/api/auth/register', applicantBody(2, { dob: '2007-01-02' }))
check('FR-05', 'Applicant cannot open another applicant record', (await ap2.get(`/api/applicants/${aid}?purpose=curiosity check`)).status === 403)
check('NFR-02', 'Applicant cannot list applicants', (await ap2.get('/api/applicants')).status === 403)
check('NFR-02', 'Cashier cannot resolve tickets', (await staff.cashier.post(`/api/tickets/${tk.id}/resolve`, { remark: 'Done here' })).status === 403)
check('NFR-02', 'Officer cannot validate payments', (await staff.officer.post(`/api/applicants/${aid}/payment`, { or_number: 'X1', amount: 500 })).status === 403)
check('NFR-02', 'DPO cannot open applicant records', (await staff.dpo.get(`/api/applicants/${aid}?purpose=random look`)).status === 403)
check('NFR-02', 'Anonymous cannot read the audit log', (await anon.get('/api/audit')).status === 401)
check('NFR-03', 'Sensitive profile is ciphertext at rest', (() => { const r = rows(`SELECT enc FROM applicants WHERE id=${aid}`)[0]; return /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(r.enc) && !r.enc.includes('0917') })())
check('NFR-03', 'Password stored as PBKDF2 hash, not plain text', rows(`SELECT pass_hash FROM users WHERE email='juan1-${stamp}@test.local'`)[0].pass_hash !== pw)

const noPurpose = await staff.registrar.get(`/api/applicants/${aid}`)
check('FR-12', 'Opening a record without a purpose is refused', noPurpose.status === 400)
for (const [r, p] of [['registrar', 'Update requirement compliance'], ['cashier', 'Validate reservation fee payment'], ['finaid', 'Screen or endorse financial aid']]) await staff[r].get(`/api/applicants/${aid}?purpose=${encodeURIComponent(p)}`)
const log = rows(`SELECT a.user_id, a.purpose, a.created_at, u.role FROM audit_log a JOIN users u ON u.id=a.user_id WHERE a.applicant_id=${aid} AND a.action='view' AND u.role<>'applicant'`)
check('FR-12', 'Three users opening a record produce three audit entries with identity, time and purpose', log.length === 3 && log.every((l) => l.user_id && l.purpose && l.created_at), `${log.length} entries`)
const auditApi = await staff.dpo.get(`/api/audit?applicant_id=${aid}`)
check('FR-12', 'DPO reads the access log', auditApi.status === 200 && auditApi.data.rows.length >= 3)

const noOr = await staff.cashier.post(`/api/applicants/${aid}/payment`, { or_number: '', amount: 500 })
check('FR-09', 'Validation without receipt number is refused', noOr.status === 400 && rows(`SELECT COUNT(*) n FROM payments WHERE applicant_id=${aid}`)[0].n === 0)
const okPay = await staff.cashier.post(`/api/applicants/${aid}/payment`, { or_number: `OR-${stamp}`, amount: 500 })
check('FR-09', 'Validation with receipt number succeeds and stage moves to reserved', okPay.status === 200 && rows(`SELECT stage FROM applicants WHERE id=${aid}`)[0].stage === 'reserved')
check('FR-09', 'Same receipt number cannot be reused', (await staff.cashier.post(`/api/applicants/${rows(`SELECT id FROM applicants WHERE email='juan2-${stamp}@test.local'`)[0].id}/payment`, { or_number: `OR-${stamp}`, amount: 500 })).status === 409)

const reqs = rows(`SELECT id, doc_code FROM requirements WHERE applicant_id=${aid} ORDER BY id`)
check('FR-03', 'Rejecting without a reason is refused', (await staff.registrar.patch(`/api/requirements/${reqs[0].id}`, { status: 'rejected' })).status === 400)
await staff.registrar.patch(`/api/requirements/${reqs[0].id}`, { status: 'received' })
await staff.registrar.patch(`/api/requirements/${reqs[1].id}`, { status: 'rejected', note: 'Scan unreadable' })
const my2 = await ap1.get('/api/my')
const st = Object.fromEntries(my2.data.requirements.map((r) => [r.doc_code, r.status]))
check('FR-03', 'Displayed statuses match encoded values', st[reqs[0].doc_code] === 'received' && st[reqs[1].doc_code] === 'rejected' && st[reqs[2].doc_code] === 'pending')

sql(`UPDATE requirements SET deadline='2020-01-01' WHERE applicant_id=${aid} AND status<>'received'`)
const nr = await staff.registrar.post('/api/notices/run')
const notice = rows(`SELECT body FROM notices WHERE applicant_id=${aid} ORDER BY id DESC LIMIT 1`)[0]
check('FR-10', 'Deficiency notice lists each pending item past its deadline', nr.data.issued >= 1 && notice && reqs.slice(1).every((r) => true) && (notice.body.match(/due 2020-01-01/g) || []).length === 3, `${(notice?.body.match(/due 2020-01-01/g) || []).length} items`)
check('FR-10', 'Re-running does not duplicate an unchanged notice', (await staff.registrar.post('/api/notices/run')).data.issued === 0)
check('FR-10', 'Applicant sees the notice', (await ap1.get('/api/my')).data.notices.length >= 1)

const bad = await staff.finaid.post('/api/aid/endorse', { applicant_id: aid, program_code: 'SHSVP' })
check('FR-11', 'Endorsing a program the profile does not meet is refused', bad.status === 409)
const end = await staff.finaid.post('/api/aid/endorse', { applicant_id: aid, program_code: 'TDP' })
const q = await staff.finaid.get('/api/aid/queue')
const row = q.data.rows.find((r) => r.applicant_id === aid && r.program_name === 'Tulong Dunong Program')
check('FR-11', 'Endorsed case appears in coordinator queue with its document list', end.status === 200 && row && row.documents.length === 3)

check('FR-13', 'Resolving without a closing remark is refused', (await staff.officer.post(`/api/tickets/${tk.id}/resolve`, { remark: '' })).status === 400)
await staff.officer.patch(`/api/tickets/${tk.id}`, { assignee_id: staff.officer.id })
check('FR-13', 'Ticket assigned to exactly one named officer', rows(`SELECT assignee_id FROM tickets WHERE id=${tk.id}`)[0].assignee_id === staff.officer.id)
const res = await staff.officer.post(`/api/tickets/${tk.id}/resolve`, { remark: 'BSIT tuition for first year is posted at the cashier; we emailed the breakdown.' })
check('FR-13', 'Ticket resolves with a remark and the applicant can read it', res.status === 200 && (await anon.get(`/api/inquiries/status?code=${inq.data.code}&email=ana-${stamp}@test.local`)).data.ticket.closing_remark.startsWith('BSIT'))

const old = await anon.post('/api/inquiries', { name: 'Old Case', email: `old-${stamp}@test.local`, subject: 'Old', message: 'Seeded overdue case', consent: true })
const oldId = rows(`SELECT id FROM tickets WHERE code='${old.data.code}'`)[0].id
sql(`UPDATE tickets SET created_at='2026-10-01 01:00:00' WHERE id=${oldId}`)
const fresh = await anon.post('/api/inquiries', { name: 'Fresh Case', email: `fresh-${stamp}@test.local`, subject: 'Fresh', message: 'Not overdue', consent: true })
sql("DELETE FROM meta WHERE key='jobs_at'")
const tl = await staff.officer.get('/api/tickets')
const oldRow = tl.data.rows.find((t) => t.id === oldId)
check('FR-06', 'Elapsed working days computed against the tier ceiling', oldRow && oldRow.sla.ceiling === 3 && oldRow.sla.elapsed >= 19 && oldRow.sla.overdue, `elapsed ${oldRow?.sla.elapsed}`)
const esc = await admin.get('/api/escalations')
check('FR-14', 'Overdue case appears in the administrator queue', esc.data.rows.some((t) => t.id === oldId))
check('FR-14', 'Fresh case is not escalated', !esc.data.rows.some((t) => t.code === fresh.data.code))
check('NFR-02', 'Officer cannot read the escalation queue', (await staff.officer.get('/api/escalations')).status === 403)

const an = await admin.get('/api/analytics?from=2026-01-01&to=2026-12-31')
const raw = rows("SELECT COUNT(*) n FROM tickets WHERE date(created_at,'+8 hours') BETWEEN '2026-01-01' AND '2026-12-31'")[0].n
check('FR-07', 'Report volume reconciles with the raw case list', an.status === 200 && an.data.volume.total === raw && an.data.volume.open + an.data.volume.resolved === raw, `${an.data.volume.total} vs ${raw}`)
const appsRaw = rows("SELECT COUNT(*) n FROM applicants WHERE date(created_at,'+8 hours') BETWEEN '2026-01-01' AND '2026-12-31'")[0].n
check('FR-07', 'Stage funnel reconciles with the applicant list', an.data.funnel.applicants === appsRaw && an.data.funnel.reserved >= 1)
const csv = await admin.get('/api/analytics.csv?from=2026-01-01&to=2026-12-31')
check('FR-07', 'CSV export has one row per case', typeof csv.data === 'string' && csv.data.trim().split('\n').length === raw + 1)

const exp = await ap1.get('/api/my/export')
check('FR-12', 'Applicant data export includes the access log', exp.status === 200 && exp.data.access_log.length >= 3)
check('SEC', 'POST without the request header is refused', (await fetch(BASE + '/api/inquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 403)
for (let i = 0; i < 5; i++) await new Agent().post('/api/auth/login', { email: `juan1-${stamp}@test.local`, password: 'wrong-password-x' })
check('SEC', 'Login locks after 5 failed attempts', (await new Agent().post('/api/auth/login', { email: `juan1-${stamp}@test.local`, password: pw })).status === 429)
const home = await fetch(BASE + '/')
check('SEC', 'Content-Security-Policy header sent', !!home.headers.get('content-security-policy'))

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
