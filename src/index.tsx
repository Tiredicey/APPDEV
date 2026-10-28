import { Hono, type Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { hashPassword, randomToken, safeEqual, seal, unseal, blindIndex, toB64 } from './lib/crypto'
import { slaState, manilaDate, TIER_DAYS, type Tier } from './lib/sla'
import { screen, type Profile } from './lib/eligibility'
import { page } from './page'

type Role = 'applicant' | 'officer' | 'registrar' | 'cashier' | 'finaid' | 'dpo' | 'admin'
type User = { id: number; email: string; name: string; role: Role }
type Bindings = { DB: D1Database; ENC_KEY: string }
type Env = { Bindings: Bindings; Variables: { user: User | null } }
type C = Context<Env>

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

const CONSENT_VERSION = '2026-10'
const CONSENT_TEXT =
  'I consent to STI College Lipa collecting and processing the personal data in this form for the purpose stated below. I understand that the Data Privacy Act of 2012 (Republic Act No. 10173) gives me the right to be informed, to access, to correct, and to object, and that I may exercise these rights through the campus Data Protection Officer.'
const PURPOSE_INQUIRY = 'Respond to an admissions inquiry'
const PURPOSE_APPLICATION = 'Process an admission application, requirement compliance, and financial aid screening'
const STAFF: Role[] = ['officer', 'registrar', 'cashier', 'finaid', 'dpo', 'admin']
const RECORD_VIEWERS: Role[] = ['officer', 'registrar', 'cashier', 'finaid', 'admin']
const SESSION_HOURS = 12

const app = new Hono<Env>()

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:'],
    mediaSrc: ["'self'"],
    scriptSrc: ["'self'"],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"]
  },
  referrerPolicy: 'strict-origin-when-cross-origin'
}))

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400)
  console.error(err)
  return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500)
})

const all = async <T = any>(c: C, sql: string, ...args: unknown[]) => (await c.env.DB.prepare(sql).bind(...args).all<T>()).results
const one = <T = any>(c: C, sql: string, ...args: unknown[]) => c.env.DB.prepare(sql).bind(...args).first<T>()
const run = (c: C, sql: string, ...args: unknown[]) => c.env.DB.prepare(sql).bind(...args).run()

const str = (v: unknown, field: string, min = 1, max = 2000) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < min) throw new HttpError(400, `${field} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`)
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`)
  return s
}
const email = (v: unknown) => {
  const s = str(v, 'Email', 3, 200).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'Enter a valid email address.')
  return s
}
const oneOf = <T extends string>(v: unknown, opts: readonly T[], field: string): T => {
  if (!opts.includes(v as T)) throw new HttpError(400, `${field} must be one of: ${opts.join(', ')}.`)
  return v as T
}
const body = async (c: C) => {
  try {
    return (await c.req.json()) as Record<string, any>
  } catch {
    throw new HttpError(400, 'Request body must be JSON.')
  }
}
const sha = async (s: string) => toB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))

const holidays = async (c: C) => new Set((await all<{ day: string }>(c, 'SELECT day FROM holidays')).map((r) => r.day))

const audit = (c: C, applicantId: number | null, action: string, purpose: string) =>
  run(c, 'INSERT INTO audit_log (user_id, applicant_id, action, purpose) VALUES (?, ?, ?, ?)', c.get('user')?.id ?? null, applicantId, action, purpose)

async function startSession(c: C, userId: number) {
  const token = randomToken()
  await run(c, "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))", await sha(token), userId, `+${SESSION_HOURS} hours`)
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', secure: new URL(c.req.url).protocol === 'https:', path: '/', maxAge: SESSION_HOURS * 3600 })
}

async function createUser(c: C, name: string, mail: string, password: string, role: Role) {
  if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.')
  if (await one(c, 'SELECT id FROM users WHERE email = ?', mail)) throw new HttpError(409, 'An account with this email already exists.')
  const salt = toB64(crypto.getRandomValues(new Uint8Array(16)))
  const r = await run(c, 'INSERT INTO users (email, name, role, pass_hash, salt) VALUES (?, ?, ?, ?, ?)', mail, name, role, await hashPassword(password, salt), salt)
  return Number(r.meta.last_row_id)
}

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header('x-admit') !== '1') throw new HttpError(403, 'Missing request header.')
  const token = getCookie(c, 'sid')
  c.set('user', null)
  if (token) {
    const u = await one<User>(c, "SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1", await sha(token))
    c.set('user', u ?? null)
  }
  await next()
})

const need = (c: C, roles: Role[]) => {
  const u = c.get('user')
  if (!u) throw new HttpError(401, 'Please sign in.')
  if (!roles.includes(u.role)) throw new HttpError(403, 'Your role does not have access to this function.')
  return u
}

async function lazyJobs(c: C) {
  const last = await one<{ value: string }>(c, "SELECT value FROM meta WHERE key = 'jobs_at'")
  if (last && Date.now() - Number(last.value) < 5 * 60 * 1000) return
  await run(c, "INSERT INTO meta (key, value) VALUES ('jobs_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(Date.now()))
  const hol = await holidays(c)
  const open = await all<{ id: number; created_at: string; tier: Tier }>(c, "SELECT id, created_at, tier FROM tickets WHERE status = 'open' AND escalated_at IS NULL AND created_at <= datetime('now', '-3 days')")
  const overdue = open.filter((t) => slaState(t.created_at, t.tier, hol).overdue).map((t) => t.id)
  for (const id of overdue) await run(c, "UPDATE tickets SET escalated_at = datetime('now') WHERE id = ?", id)
  await issueDeficiencyNotices(c, null)
}

async function issueDeficiencyNotices(c: C, actor: number | null) {
  const today = manilaDate()
  const rows = await all<{ applicant_id: number; label: string; deadline: string; status: string }>(
    c, "SELECT applicant_id, label, deadline, status FROM requirements WHERE status IN ('pending','rejected') AND deadline < ? ORDER BY applicant_id, deadline", today)
  const byApplicant = new Map<number, string[]>()
  for (const r of rows) {
    const list = byApplicant.get(r.applicant_id) ?? []
    list.push(`${r.label} (${r.status}, due ${r.deadline})`)
    byApplicant.set(r.applicant_id, list)
  }
  let issued = 0
  for (const [id, items] of byApplicant) {
    const text = `Deficiency notice: the following admission documents are still outstanding past their deadline: ${items.join('; ')}. Please submit them to the Registrar's Office or contact Admissions if you need more time.`
    const lastNotice = await one<{ body: string }>(c, 'SELECT body FROM notices WHERE applicant_id = ? ORDER BY id DESC LIMIT 1', id)
    if (lastNotice?.body === text) continue
    await run(c, 'INSERT INTO notices (applicant_id, body, created_by) VALUES (?, ?, ?)', id, text, actor)
    issued++
  }
  return issued
}

async function recomputeStage(c: C, applicantId: number) {
  const a = await one<{ stage: string }>(c, 'SELECT stage FROM applicants WHERE id = ?', applicantId)
  if (!a || a.stage === 'enrolled') return
  const paid = await one(c, 'SELECT id FROM payments WHERE applicant_id = ?', applicantId)
  const pending = await one<{ n: number }>(c, "SELECT COUNT(*) AS n FROM requirements WHERE applicant_id = ? AND status <> 'received'", applicantId)
  const stage = paid ? (pending?.n === 0 ? 'complete' : 'reserved') : 'applied'
  await run(c, 'UPDATE applicants SET stage = ? WHERE id = ?', stage, applicantId)
}

async function applicantBundle(c: C, applicantId: number) {
  const a = await one<any>(c, 'SELECT id, surname, first_name, email, level, program, stage, enc, created_at FROM applicants WHERE id = ?', applicantId)
  if (!a) throw new HttpError(404, 'Applicant not found.')
  const profile = await unseal<Profile>(c.env.ENC_KEY, a.enc)
  delete a.enc
  const [requirements, payment, notices, aid, tickets, consents] = await Promise.all([
    all(c, 'SELECT id, doc_code, label, status, deadline, note, updated_at FROM requirements WHERE applicant_id = ? ORDER BY deadline, label', applicantId),
    one(c, 'SELECT amount, or_number, validated_at FROM payments WHERE applicant_id = ?', applicantId),
    all(c, 'SELECT id, body, created_at FROM notices WHERE applicant_id = ? ORDER BY id DESC LIMIT 20', applicantId),
    all(c, 'SELECT id, program_code, program_name, amount, documents, status, endorsed_at FROM aid_cases WHERE applicant_id = ? ORDER BY id', applicantId),
    all(c, "SELECT code, subject, status, tier, created_at, resolved_at, closing_remark FROM tickets WHERE applicant_id = ? OR email = ? ORDER BY id DESC LIMIT 20", applicantId, a.email),
    all(c, 'SELECT statement_version, purpose, created_at FROM consents WHERE applicant_id = ? ORDER BY id', applicantId)
  ])
  const today = manilaDate()
  return {
    applicant: a,
    profile,
    requirements: requirements.map((r: any) => ({ ...r, overdue: r.status !== 'received' && r.deadline < today })),
    payment,
    notices,
    aid: aid.map((x: any) => ({ ...x, documents: JSON.parse(x.documents) })),
    matches: screen(profile),
    tickets,
    consents
  }
}

app.get('/api/setup', async (c) => c.json({ needed: !(await one(c, "SELECT id FROM users WHERE role = 'admin' LIMIT 1")) }))

app.post('/api/setup', async (c) => {
  if (await one(c, "SELECT id FROM users WHERE role = 'admin' LIMIT 1")) throw new HttpError(409, 'Setup is already complete.')
  const b = await body(c)
  const id = await createUser(c, str(b.name, 'Name', 2, 120), email(b.email), String(b.password ?? ''), 'admin')
  await startSession(c, id)
  return c.json({ ok: true })
})

app.post('/api/auth/login', async (c) => {
  const b = await body(c)
  const mail = email(b.email)
  const att = await one<{ fails: number; first_at: string }>(c, "SELECT fails, first_at FROM login_attempts WHERE email = ? AND first_at > datetime('now', '-15 minutes')", mail)
  if (att && att.fails >= 5) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.')
  const u = await one<User & { pass_hash: string; salt: string; active: number }>(c, 'SELECT id, email, name, role, pass_hash, salt, active FROM users WHERE email = ?', mail)
  const ok = u && u.active === 1 && safeEqual(await hashPassword(String(b.password ?? ''), u.salt), u.pass_hash)
  if (!ok) {
    await run(c, "INSERT INTO login_attempts (email, fails, first_at) VALUES (?, 1, datetime('now')) ON CONFLICT(email) DO UPDATE SET fails = CASE WHEN first_at > datetime('now', '-15 minutes') THEN fails + 1 ELSE 1 END, first_at = CASE WHEN first_at > datetime('now', '-15 minutes') THEN first_at ELSE datetime('now') END", mail)
    throw new HttpError(401, 'Email or password is incorrect.')
  }
  await run(c, 'DELETE FROM login_attempts WHERE email = ?', mail)
  await startSession(c, u.id)
  return c.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } })
})

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, 'sid')
  if (token) await run(c, 'DELETE FROM sessions WHERE token = ?', await sha(token))
  deleteCookie(c, 'sid', { path: '/' })
  return c.json({ ok: true })
})

app.get('/api/me', (c) => c.json({ user: c.get('user') }))

app.get('/api/consent', (c) => c.json({ version: CONSENT_VERSION, text: CONSENT_TEXT, purposes: { inquiry: PURPOSE_INQUIRY, application: PURPOSE_APPLICATION } }))

app.post('/api/auth/register', async (c) => {
  const b = await body(c)
  if (b.consent !== true) throw new HttpError(400, 'Consent is required before we can store your application.')
  const surname = str(b.surname, 'Surname', 1, 80)
  const first = str(b.first_name, 'First name', 1, 80)
  const mail = email(b.email)
  const dob = str(b.dob, 'Date of birth', 10, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob)) || dob > manilaDate()) throw new HttpError(400, 'Enter a valid date of birth.')
  const level = oneOf(b.level, ['SHS', 'College'] as const, 'Level')
  const program = str(b.program, 'Program or strand', 2, 120)
  const income = b.householdIncome === '' || b.householdIncome == null ? undefined : Number(b.householdIncome)
  if (income !== undefined && (!isFinite(income) || income < 0)) throw new HttpError(400, 'Household income must be a positive number.')
  const profile: Profile = {
    dob,
    phone: str(b.phone, 'Mobile number', 7, 20),
    address: str(b.address, 'Address', 5, 300),
    filipino: b.filipino === true,
    level,
    jhsType: level === 'SHS' ? oneOf(b.jhsType, ['public', 'esc', 'private'] as const, 'Junior high school type') : undefined,
    priorDegree: b.priorDegree === true,
    pwd: b.pwd === true,
    householdIncome: income,
    listahanan: b.listahanan === true,
    soloParentDependent: b.soloParentDependent === true,
    indigenous: b.indigenous === true,
    otherGovGrant: b.otherGovGrant === true
  }
  const dedup = await blindIndex(c.env.ENC_KEY, `${surname.toLowerCase().replace(/\s+/g, ' ')}|${first.toLowerCase().replace(/\s+/g, ' ')}|${dob}`)
  if (await one(c, 'SELECT id FROM applicants WHERE dedup_key = ?', dedup)) throw new HttpError(409, 'An applicant profile with the same surname, first name, and date of birth already exists. Sign in instead, or contact Admissions.')
  const userId = await createUser(c, `${first} ${surname}`, mail, String(b.password ?? ''), 'applicant')
  const r = await run(c, 'INSERT INTO applicants (user_id, surname, first_name, email, level, program, dedup_key, enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', userId, surname, first, mail, level, program, dedup, await seal(c.env.ENC_KEY, profile))
  const applicantId = Number(r.meta.last_row_id)
  const types = await all<{ code: string; label: string; deadline_days: number }>(c, "SELECT code, label, deadline_days FROM requirement_types WHERE level IN ('Both', ?)", level)
  const today = new Date(manilaDate() + 'T00:00:00Z')
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO consents (applicant_id, statement_version, statement_text, purpose) VALUES (?, ?, ?, ?)').bind(applicantId, CONSENT_VERSION, CONSENT_TEXT, PURPOSE_APPLICATION),
    ...types.map((t) => {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() + t.deadline_days)
      return c.env.DB.prepare('INSERT INTO requirements (applicant_id, doc_code, label, deadline) VALUES (?, ?, ?, ?)').bind(applicantId, t.code, t.label, d.toISOString().slice(0, 10))
    })
  ])
  await startSession(c, userId)
  return c.json({ ok: true, matches: screen(profile) })
})

app.post('/api/inquiries', async (c) => {
  const b = await body(c)
  if (b.consent !== true) throw new HttpError(400, 'Consent is required before we can store your inquiry.')
  const u = c.get('user')
  const applicant = u?.role === 'applicant' ? await one<{ id: number; email: string; first_name: string; surname: string }>(c, 'SELECT id, email, first_name, surname FROM applicants WHERE user_id = ?', u.id) : null
  const name = applicant ? `${applicant.first_name} ${applicant.surname}` : str(b.name, 'Name', 2, 120)
  const mail = applicant ? applicant.email : email(b.email)
  const r = await run(c, 'INSERT INTO tickets (code, applicant_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?, ?)', randomToken(9), applicant?.id ?? null, name, mail, str(b.subject, 'Subject', 3, 140), str(b.message, 'Message', 5, 4000))
  const id = Number(r.meta.last_row_id)
  const code = `ADM-${manilaDate().slice(0, 4)}-${String(id).padStart(5, '0')}`
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE tickets SET code = ? WHERE id = ?').bind(code, id),
    c.env.DB.prepare('INSERT INTO consents (applicant_id, ticket_id, statement_version, statement_text, purpose) VALUES (?, ?, ?, ?, ?)').bind(applicant?.id ?? null, id, CONSENT_VERSION, CONSENT_TEXT, PURPOSE_INQUIRY)
  ])
  const sla = slaState(new Date().toISOString().slice(0, 19).replace('T', ' '), 'simple', await holidays(c))
  return c.json({ code, due: sla.due })
})

app.get('/api/inquiries/status', async (c) => {
  const code = str(c.req.query('code'), 'Ticket number', 5, 30).toUpperCase()
  const mail = email(c.req.query('email'))
  const t = await one<any>(c, 'SELECT t.code, t.subject, t.status, t.tier, t.created_at, t.resolved_at, t.closing_remark, u.name AS officer FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.code = ? AND t.email = ?', code, mail)
  if (!t) throw new HttpError(404, 'No ticket matches that number and email.')
  return c.json({ ticket: { ...t, sla: slaState(t.created_at, t.tier, await holidays(c), t.resolved_at) } })
})

app.get('/api/my', async (c) => {
  const u = need(c, ['applicant'])
  await lazyJobs(c)
  const a = await one<{ id: number }>(c, 'SELECT id FROM applicants WHERE user_id = ?', u.id)
  if (!a) throw new HttpError(404, 'No applicant profile is linked to this account.')
  await audit(c, a.id, 'view', 'Applicant viewed own record')
  return c.json(await applicantBundle(c, a.id))
})

app.get('/api/my/export', async (c) => {
  const u = need(c, ['applicant'])
  const a = await one<{ id: number }>(c, 'SELECT id FROM applicants WHERE user_id = ?', u.id)
  if (!a) throw new HttpError(404, 'No applicant profile is linked to this account.')
  await audit(c, a.id, 'export', 'Applicant exercised the right to access (data export)')
  const data = await applicantBundle(c, a.id)
  const accessLog = await all(c, 'SELECT a.created_at, a.action, a.purpose, COALESCE(u.name, \'System\') AS by_user, u.role FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.applicant_id = ? ORDER BY a.id DESC LIMIT 500', a.id)
  c.header('Content-Disposition', `attachment; filename="admit-lipa-my-data-${manilaDate()}.json"`)
  return c.json({ exported_at: new Date().toISOString(), ...data, access_log: accessLog })
})

app.get('/api/applicants', async (c) => {
  need(c, RECORD_VIEWERS)
  await lazyJobs(c)
  const q = (c.req.query('q') ?? '').trim()
  const stage = c.req.query('stage') ?? ''
  const pageNo = Math.max(1, Number(c.req.query('page') ?? 1) || 1)
  const where: string[] = []
  const args: unknown[] = []
  if (q) {
    where.push("(a.surname LIKE ? OR a.first_name LIKE ? OR a.email LIKE ? OR a.program LIKE ?)")
    args.push(...Array(4).fill(`%${q}%`))
  }
  if (stage) {
    where.push('a.stage = ?')
    args.push(oneOf(stage, ['applied', 'reserved', 'complete', 'enrolled'] as const, 'Stage'))
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = await all(c, `SELECT a.id, a.surname, a.first_name, a.email, a.level, a.program, a.stage, a.created_at,
      (SELECT COUNT(*) FROM requirements r WHERE r.applicant_id = a.id AND r.status <> 'received') AS pending,
      (SELECT COUNT(*) FROM requirements r WHERE r.applicant_id = a.id AND r.status <> 'received' AND r.deadline < ?) AS overdue
    FROM applicants a ${w} ORDER BY a.id DESC LIMIT 26 OFFSET ?`, manilaDate(), ...args, (pageNo - 1) * 25)
  return c.json({ rows: rows.slice(0, 25), more: rows.length > 25, page: pageNo })
})

app.get('/api/applicants/:id', async (c) => {
  need(c, RECORD_VIEWERS)
  const id = Number(c.req.param('id'))
  const purpose = str(c.req.query('purpose'), 'Purpose of access', 5, 200)
  const data = await applicantBundle(c, id)
  await audit(c, id, 'view', purpose)
  return c.json(data)
})

app.patch('/api/applicants/:id/stage', async (c) => {
  need(c, ['registrar', 'admin'])
  const id = Number(c.req.param('id'))
  const b = await body(c)
  const a = await one<{ stage: string }>(c, 'SELECT stage FROM applicants WHERE id = ?', id)
  if (!a) throw new HttpError(404, 'Applicant not found.')
  if (b.stage === 'enrolled' && a.stage !== 'complete') throw new HttpError(409, 'Only an applicant with a validated reservation fee and complete requirements can be marked enrolled.')
  oneOf(b.stage, ['enrolled'] as const, 'Stage')
  await run(c, "UPDATE applicants SET stage = 'enrolled' WHERE id = ?", id)
  await audit(c, id, 'update', 'Marked applicant as enrolled')
  return c.json({ ok: true })
})

app.patch('/api/requirements/:id', async (c) => {
  const u = need(c, ['registrar', 'officer', 'admin'])
  const b = await body(c)
  const status = oneOf(b.status, ['pending', 'received', 'rejected'] as const, 'Status')
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : null
  if (status === 'rejected' && !note) throw new HttpError(400, 'Give a reason when rejecting a document, so the applicant knows what to fix.')
  const r = await one<{ applicant_id: number; label: string }>(c, 'SELECT applicant_id, label FROM requirements WHERE id = ?', Number(c.req.param('id')))
  if (!r) throw new HttpError(404, 'Requirement not found.')
  await run(c, "UPDATE requirements SET status = ?, note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?", status, note, u.id, Number(c.req.param('id')))
  await audit(c, r.applicant_id, 'update', `Set ${r.label} to ${status}`)
  await recomputeStage(c, r.applicant_id)
  return c.json({ ok: true })
})

app.post('/api/applicants/:id/payment', async (c) => {
  const u = need(c, ['cashier', 'admin'])
  const id = Number(c.req.param('id'))
  const b = await body(c)
  const or = typeof b.or_number === 'string' ? b.or_number.trim() : ''
  if (!or) throw new HttpError(400, 'The official receipt number is required to validate a reservation fee.')
  if (or.length > 40) throw new HttpError(400, 'Official receipt number is too long.')
  const amount = Number(b.amount)
  if (!isFinite(amount) || amount <= 0) throw new HttpError(400, 'Enter the amount paid.')
  if (!(await one(c, 'SELECT id FROM applicants WHERE id = ?', id))) throw new HttpError(404, 'Applicant not found.')
  if (await one(c, 'SELECT id FROM payments WHERE applicant_id = ?', id)) throw new HttpError(409, 'This applicant already has a validated reservation fee.')
  if (await one(c, 'SELECT id FROM payments WHERE or_number = ?', or)) throw new HttpError(409, 'That official receipt number is already used on another applicant.')
  await run(c, 'INSERT INTO payments (applicant_id, amount, or_number, validated_by) VALUES (?, ?, ?, ?)', id, amount, or, u.id)
  await audit(c, id, 'update', `Validated reservation fee, OR ${or}`)
  await recomputeStage(c, id)
  return c.json({ ok: true })
})

app.post('/api/notices/run', async (c) => {
  const u = need(c, ['registrar', 'officer', 'admin'])
  return c.json({ issued: await issueDeficiencyNotices(c, u.id) })
})

app.post('/api/applicants/:id/notice', async (c) => {
  const u = need(c, ['registrar', 'officer', 'admin'])
  const id = Number(c.req.param('id'))
  const b = await body(c)
  if (!(await one(c, 'SELECT id FROM applicants WHERE id = ?', id))) throw new HttpError(404, 'Applicant not found.')
  await run(c, 'INSERT INTO notices (applicant_id, body, created_by) VALUES (?, ?, ?)', id, str(b.body, 'Notice text', 5, 2000), u.id)
  await audit(c, id, 'update', 'Issued a written notice')
  return c.json({ ok: true })
})

app.post('/api/aid/endorse', async (c) => {
  const u = need(c, ['finaid', 'admin'])
  const b = await body(c)
  const id = Number(b.applicant_id)
  const a = await one<{ enc: string }>(c, 'SELECT enc FROM applicants WHERE id = ?', id)
  if (!a) throw new HttpError(404, 'Applicant not found.')
  const match = screen(await unseal<Profile>(c.env.ENC_KEY, a.enc)).find((m) => m.code === b.program_code)
  if (!match) throw new HttpError(409, 'This applicant does not meet the screened criteria for that program.')
  if (await one(c, 'SELECT id FROM aid_cases WHERE applicant_id = ? AND program_code = ?', id, match.code)) throw new HttpError(409, 'This program is already endorsed for the applicant.')
  await run(c, 'INSERT INTO aid_cases (applicant_id, program_code, program_name, amount, documents, endorsed_by) VALUES (?, ?, ?, ?, ?, ?)', id, match.code, match.name, match.amount, JSON.stringify(match.documents), u.id)
  await audit(c, id, 'update', `Endorsed ${match.name}`)
  return c.json({ ok: true })
})

app.get('/api/aid/queue', async (c) => {
  need(c, ['finaid', 'admin'])
  const rows = await all<any>(c, "SELECT x.id, x.applicant_id, a.surname, a.first_name, x.program_name, x.amount, x.documents, x.status, x.endorsed_at FROM aid_cases x JOIN applicants a ON a.id = x.applicant_id ORDER BY CASE x.status WHEN 'endorsed' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END, x.id DESC LIMIT 200")
  return c.json({ rows: rows.map((r) => ({ ...r, documents: JSON.parse(r.documents) })) })
})

app.patch('/api/aid/:id', async (c) => {
  need(c, ['finaid', 'admin'])
  const b = await body(c)
  const status = oneOf(b.status, ['endorsed', 'submitted', 'approved', 'denied'] as const, 'Status')
  const x = await one<{ applicant_id: number; program_name: string }>(c, 'SELECT applicant_id, program_name FROM aid_cases WHERE id = ?', Number(c.req.param('id')))
  if (!x) throw new HttpError(404, 'Aid case not found.')
  await run(c, 'UPDATE aid_cases SET status = ? WHERE id = ?', status, Number(c.req.param('id')))
  await audit(c, x.applicant_id, 'update', `${x.program_name} set to ${status}`)
  return c.json({ ok: true })
})

app.get('/api/tickets', async (c) => {
  const u = need(c, ['officer', 'admin'])
  await lazyJobs(c)
  const status = c.req.query('status') === 'resolved' ? 'resolved' : 'open'
  const mine = c.req.query('mine') === '1'
  const rows = await all<any>(c, `SELECT t.id, t.code, t.name, t.email, t.subject, t.message, t.tier, t.status, t.assignee_id, u.name AS assignee, t.closing_remark, t.escalated_at, t.created_at, t.resolved_at, t.applicant_id
    FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.status = ? ${mine ? 'AND t.assignee_id = ?' : ''} ORDER BY t.id ${status === 'open' ? 'ASC' : 'DESC'} LIMIT 200`, status, ...(mine ? [u.id] : []))
  const hol = await holidays(c)
  const officers = await all(c, "SELECT id, name FROM users WHERE role IN ('officer','admin') AND active = 1 ORDER BY name")
  return c.json({ rows: rows.map((t) => ({ ...t, sla: slaState(t.created_at, t.tier, hol, t.resolved_at) })), officers })
})

app.patch('/api/tickets/:id', async (c) => {
  need(c, ['officer', 'admin'])
  const b = await body(c)
  const id = Number(c.req.param('id'))
  const t = await one<{ status: string }>(c, 'SELECT status FROM tickets WHERE id = ?', id)
  if (!t) throw new HttpError(404, 'Ticket not found.')
  if (t.status !== 'open') throw new HttpError(409, 'Resolved tickets cannot be changed.')
  if (b.assignee_id !== undefined) {
    const officer = await one(c, "SELECT id FROM users WHERE id = ? AND role IN ('officer','admin') AND active = 1", Number(b.assignee_id))
    if (!officer) throw new HttpError(400, 'Choose an active admissions officer.')
    await run(c, 'UPDATE tickets SET assignee_id = ? WHERE id = ?', Number(b.assignee_id), id)
  }
  if (b.tier !== undefined) await run(c, 'UPDATE tickets SET tier = ? WHERE id = ?', oneOf(b.tier, Object.keys(TIER_DAYS) as Tier[], 'Tier'), id)
  return c.json({ ok: true })
})

app.post('/api/tickets/:id/resolve', async (c) => {
  const u = need(c, ['officer', 'admin'])
  const b = await body(c)
  const remark = typeof b.remark === 'string' ? b.remark.trim() : ''
  if (remark.length < 5) throw new HttpError(400, 'A closing remark of at least 5 characters is required to resolve a ticket.')
  const id = Number(c.req.param('id'))
  const t = await one<{ status: string; assignee_id: number | null }>(c, 'SELECT status, assignee_id FROM tickets WHERE id = ?', id)
  if (!t) throw new HttpError(404, 'Ticket not found.')
  if (t.status !== 'open') throw new HttpError(409, 'Ticket is already resolved.')
  await run(c, "UPDATE tickets SET status = 'resolved', closing_remark = ?, assignee_id = COALESCE(assignee_id, ?), resolved_at = datetime('now') WHERE id = ?", remark.slice(0, 2000), u.id, id)
  return c.json({ ok: true })
})

app.get('/api/escalations', async (c) => {
  need(c, ['admin'])
  await lazyJobs(c)
  const rows = await all<any>(c, "SELECT t.id, t.code, t.name, t.subject, t.tier, t.created_at, t.escalated_at, u.name AS assignee FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.status = 'open' AND t.escalated_at IS NOT NULL ORDER BY t.created_at")
  const hol = await holidays(c)
  return c.json({ rows: rows.map((t) => ({ ...t, sla: slaState(t.created_at, t.tier, hol) })) })
})

async function analytics(c: C, from: string, to: string) {
  const hol = await holidays(c)
  const tickets = await all<any>(c, "SELECT id, code, subject, tier, status, created_at, resolved_at, escalated_at FROM tickets WHERE date(created_at, '+8 hours') BETWEEN ? AND ? ORDER BY id", from, to)
  const applicants = await all<{ stage: string; n: number }>(c, "SELECT stage, COUNT(*) AS n FROM applicants WHERE date(created_at, '+8 hours') BETWEEN ? AND ? GROUP BY stage", from, to)
  const enriched = tickets.map((t) => ({ ...t, sla: slaState(t.created_at, t.tier, hol, t.resolved_at) }))
  const byDay: Record<string, number> = {}
  for (const t of enriched) byDay[manilaDate(t.created_at)] = (byDay[manilaDate(t.created_at)] ?? 0) + 1
  const resolved = enriched.filter((t) => t.status === 'resolved')
  const open = enriched.filter((t) => t.status === 'open')
  const buckets = [['0-1', 0, 1], ['2-3', 2, 3], ['4-7', 4, 7], ['8-20', 8, 20], ['21+', 21, Infinity]] as const
  const stageCount = Object.fromEntries(['applied', 'reserved', 'complete', 'enrolled'].map((s) => [s, applicants.find((a) => a.stage === s)?.n ?? 0]))
  const reachedReserved = stageCount.reserved + stageCount.complete + stageCount.enrolled
  const reachedComplete = stageCount.complete + stageCount.enrolled
  const totalApplicants = Object.values(stageCount).reduce((x, y) => x + y, 0)
  return {
    from, to,
    volume: { total: enriched.length, open: open.length, resolved: resolved.length, byDay },
    sla: {
      resolvedWithin: resolved.filter((t) => !t.sla.overdue).length,
      resolvedLate: resolved.filter((t) => t.sla.overdue).length,
      openOverdue: open.filter((t) => t.sla.overdue).length,
      medianResolutionDays: resolved.length ? [...resolved.map((t) => t.sla.elapsed)].sort((a, b) => a - b)[Math.floor((resolved.length - 1) / 2)] : null
    },
    aging: buckets.map(([label, lo, hi]) => ({ label, count: open.filter((t) => t.sla.elapsed >= lo && t.sla.elapsed <= hi).length })),
    funnel: {
      applicants: totalApplicants,
      stageCount,
      reserved: reachedReserved,
      complete: reachedComplete,
      enrolled: stageCount.enrolled
    },
    cases: enriched
  }
}

const range = (c: C) => {
  const today = manilaDate()
  const d = new Date(today + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 29)
  const from = c.req.query('from') || d.toISOString().slice(0, 10)
  const to = c.req.query('to') || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new HttpError(400, 'Choose a valid date range.')
  return [from, to] as const
}

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\n')
}

app.get('/api/analytics', async (c) => {
  need(c, ['admin'])
  const [from, to] = range(c)
  const a = await analytics(c, from, to)
  return c.json({ ...a, cases: a.cases.length })
})

app.get('/api/analytics.csv', async (c) => {
  need(c, ['admin'])
  const [from, to] = range(c)
  const a = await analytics(c, from, to)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="admit-lipa-cases-${from}-to-${to}.csv"`)
  return c.body(csv(a.cases.map((t) => ({ code: t.code, subject: t.subject, tier: t.tier, status: t.status, created_manila: manilaDate(t.created_at), resolved_manila: t.resolved_at ? manilaDate(t.resolved_at) : '', working_days: t.sla.elapsed, ceiling: t.sla.ceiling, overdue: t.sla.overdue ? 'yes' : 'no', escalated: t.escalated_at ? 'yes' : 'no' }))))
})

const auditQuery = async (c: C) => {
  const [from, to] = range(c)
  const applicant = c.req.query('applicant_id')
  return all<any>(c, `SELECT a.id, a.created_at, COALESCE(u.name, 'System') AS user_name, u.role, a.applicant_id, p.surname || ', ' || p.first_name AS applicant, a.action, a.purpose
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN applicants p ON p.id = a.applicant_id
    WHERE date(a.created_at, '+8 hours') BETWEEN ? AND ? ${applicant ? 'AND a.applicant_id = ?' : ''} ORDER BY a.id DESC LIMIT 1000`, from, to, ...(applicant ? [Number(applicant)] : []))
}

app.get('/api/audit', async (c) => {
  need(c, ['dpo', 'admin'])
  return c.json({ rows: await auditQuery(c) })
})

app.get('/api/audit.csv', async (c) => {
  need(c, ['dpo', 'admin'])
  const rows = await auditQuery(c)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="admit-lipa-audit-${manilaDate()}.csv"`)
  return c.body(csv(rows))
})

app.get('/api/users', async (c) => {
  need(c, ['admin'])
  return c.json({ rows: await all(c, "SELECT id, name, email, role, active, created_at FROM users WHERE role <> 'applicant' ORDER BY role, name") })
})

app.post('/api/users', async (c) => {
  need(c, ['admin'])
  const b = await body(c)
  const role = oneOf(b.role, STAFF, 'Role')
  const id = await createUser(c, str(b.name, 'Name', 2, 120), email(b.email), String(b.password ?? ''), role)
  return c.json({ id })
})

app.patch('/api/users/:id', async (c) => {
  const me = need(c, ['admin'])
  const id = Number(c.req.param('id'))
  const b = await body(c)
  if (id === me.id) throw new HttpError(409, 'You cannot deactivate your own account.')
  await run(c, "UPDATE users SET active = ? WHERE id = ? AND role <> 'applicant'", b.active ? 1 : 0, id)
  if (!b.active) await run(c, 'DELETE FROM sessions WHERE user_id = ?', id)
  return c.json({ ok: true })
})

app.get('/api/holidays', async (c) => {
  need(c, STAFF)
  return c.json({ rows: await all(c, 'SELECT day, label FROM holidays ORDER BY day') })
})

app.post('/api/holidays', async (c) => {
  need(c, ['admin'])
  const b = await body(c)
  const day = str(b.day, 'Date', 10, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Enter a valid date.')
  await run(c, 'INSERT INTO holidays (day, label) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET label = excluded.label', day, str(b.label, 'Holiday name', 2, 120))
  return c.json({ ok: true })
})

app.delete('/api/holidays/:day', async (c) => {
  need(c, ['admin'])
  await run(c, 'DELETE FROM holidays WHERE day = ?', c.req.param('day'))
  return c.json({ ok: true })
})

app.get('/api/health', (c) => c.json({ ok: true }))

app.get('*', (c) => c.html(page()))

export default app
