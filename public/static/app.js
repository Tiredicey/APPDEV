(() => {
  const $ = (s, r = document) => r.querySelector(s)
  const main = $('#main')
  const topbar = $('#topbar')
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const peso = (n) => 'P' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const day = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length <= 10 ? 'T00:00:00' : 'Z')).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }) : '')
  const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }) : '')
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const ROLE_LABEL = { applicant: 'Applicant', officer: 'Admissions Officer', registrar: 'Registrar', cashier: 'Cashier / Finance', finaid: 'Financial Aid Coordinator', dpo: 'Data Protection Officer', admin: 'School Administrator' }
  const STAGES = [['applied', 'Applied'], ['reserved', 'Fee validated'], ['complete', 'Requirements complete'], ['enrolled', 'Enrolled']]
  const TIERS = { simple: 'Simple (3 working days)', complex: 'Complex (7 working days)', technical: 'Highly technical (20 working days)' }
  let me = null
  let consent = null

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-admit': '1', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const e = new Error(data.error || `Request failed (${res.status})`)
      e.status = res.status
      throw e
    }
    return data
  }

  function toast(msg, bad) {
    const t = document.createElement('div')
    t.className = 'toast' + (bad ? ' bad' : '')
    t.textContent = msg
    $('#toasts').append(t)
    setTimeout(() => t.remove(), 4200)
  }

  const formData = (form) => {
    const o = {}
    for (const el of form.elements) {
      if (!el.name) continue
      if (el.type === 'checkbox') o[el.name] = el.checked
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value }
      else o[el.name] = el.value
    }
    return o
  }

  async function submitForm(form, fn) {
    const btn = form.querySelector('[type=submit]')
    const err = form.querySelector('.form-error')
    if (err) err.textContent = ''
    btn && (btn.disabled = true)
    try {
      await fn(formData(form))
    } catch (e) {
      if (err) { err.textContent = e.message; err.focus?.() } else toast(e.message, true)
    } finally {
      btn && (btn.disabled = false)
    }
  }

  const go = (path) => { history.pushState({}, '', path); route() }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]')
    if (!a || a.hasAttribute('download') || a.target || e.ctrlKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    go(a.getAttribute('href'))
  })
  addEventListener('popstate', route)

  const isStaff = () => me && me.role !== 'applicant'
  const has = (...roles) => me && roles.includes(me.role)

  function nav() {
    const links = []
    if (!me || me.role === 'applicant') links.push(['/ask', 'Ask'], ['/track', 'Track a ticket'])
    if (me?.role === 'applicant') links.push(['/me', 'My application'])
    if (!me) links.push(['/apply', 'Apply'])
    if (has('officer', 'admin')) links.push(['/staff/tickets', 'Tickets'])
    if (has('officer', 'registrar', 'cashier', 'finaid', 'admin')) links.push(['/staff/applicants', 'Applicants'])
    if (has('finaid', 'admin')) links.push(['/staff/aid', 'Financial aid'])
    if (has('admin')) links.push(['/staff/escalations', 'Escalations'], ['/staff/analytics', 'Analytics'], ['/staff/users', 'Staff & calendar'])
    if (has('dpo', 'admin')) links.push(['/staff/audit', 'Audit log'])
    const here = location.pathname
    const theme = document.documentElement.dataset.theme || 'auto'
    topbar.innerHTML = `<a class="brand" href="/">ADMIT-Lipa <small>STI College Lipa Admissions</small></a>
      <nav class="nav" aria-label="Main">${links.map(([h, l]) => `<a href="${h}" ${here === h || (h !== '/' && here.startsWith(h + '/')) ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="userbox">
        <button class="btn ghost" id="theme-btn" type="button" aria-label="Colour theme: ${theme}. Change theme">${theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'}</button>
        ${me ? `<span class="small muted">${esc(me.name)} · ${ROLE_LABEL[me.role]}</span><button class="btn" id="logout-btn" type="button">Sign out</button>` : `<a class="btn" href="/login">Sign in</a>`}
      </div>`
  }

  topbar.addEventListener('click', async (e) => {
    if (e.target.id === 'logout-btn') {
      await api('/api/auth/logout', { method: 'POST' })
      me = null
      toast('Signed out.')
      go('/')
    }
    if (e.target.id === 'theme-btn') {
      const order = ['auto', 'light', 'dark']
      const cur = document.documentElement.dataset.theme || 'auto'
      const next = order[(order.indexOf(cur) + 1) % 3]
      if (next === 'auto') { delete document.documentElement.dataset.theme; localStorage.removeItem('admit-theme') } else { document.documentElement.dataset.theme = next; localStorage.setItem('admit-theme', next) }
      nav()
    }
  })

  const view = (html, flush) => {
    main.className = flush ? 'flush' : ''
    main.innerHTML = html
    main.focus({ preventScroll: true })
    scrollTo(0, 0)
  }
  const loading = () => view('<p class="loading">Loading</p>')
  const consentBox = (purpose) => `<div class="consent"><p>${esc(consent?.text || '')}</p><p><b>Purpose:</b> ${esc(purpose)}</p>
    <label class="check"><input type="checkbox" name="consent" required> I have read and agree to this consent statement (version ${esc(consent?.version || '')}).</label></div>`

  function home() {
    const play = !reduceMotion.matches && localStorage.getItem('admit-motion') !== 'off'
    view(`<section class="hero" id="hero-section" aria-labelledby="hero-title">
        <video id="hero-video" muted loop playsinline preload="metadata" poster="/static/station-fall.jpg" aria-hidden="true" ${play ? 'autoplay' : ''}><source src="/static/station-fall.mp4" type="video/mp4"></video>
        <button class="btn motion-toggle" id="motion-btn" type="button" aria-pressed="${play}">${play ? 'Pause background' : 'Play background'}</button>
        <div class="hero-inner">
          <p class="clock">Every inquiry gets a ticket number and a due date</p>
          <h1 id="hero-title">Admissions answers, on the clock.</h1>
          <p class="lead">Ask STI College Lipa Admissions a question and get a ticket number with a promised reply date. Apply once and see your requirements, reservation fee and any government subsidy you may qualify for, in one place.</p>
          <div class="btn-row"><a class="btn primary" href="/ask">Ask Admissions</a><a class="btn" href="/apply">Start an application</a><a class="btn" href="/track">Track a ticket</a></div>
        </div>
      </section>
      <section class="paths" aria-label="What you can do">
        <article class="path lead-path"><h2>Ask without chasing</h2><p>Your question becomes a numbered ticket owned by a named officer. Simple questions are due in 3 working days, complex ones in 7, highly technical ones in 20.</p><a href="/ask">Send a question</a></article>
        <article class="path"><h2>Know what's missing early</h2><p>Each required document shows received, pending or rejected with its own deadline, so a gap shows up weeks before classes start.</p><a href="/apply">Apply</a></article>
        <article class="path"><h2>Don't miss a subsidy</h2><p>Your profile is checked against TES, TES-3A, Tulong Dunong and the DepEd SHS Voucher rules, with the documents each one needs.</p><a href="/apply">See what you may qualify for</a></article>
      </section>`, true)
    const v = $('#hero-video')
    $('#motion-btn').addEventListener('click', (e) => {
      const on = v.paused
      on ? v.play().catch(() => {}) : v.pause()
      localStorage.setItem('admit-motion', on ? 'on' : 'off')
      e.currentTarget.setAttribute('aria-pressed', on)
      e.currentTarget.textContent = on ? 'Pause background' : 'Play background'
    })
  }

  function ask() {
    const known = me?.role === 'applicant'
    view(`<div class="auth"><div class="section"><h1>Ask Admissions</h1><p class="muted">You'll get a ticket number right away. Keep it to check the reply.</p>
      <form class="stack" id="ask-form" novalidate>
        ${known ? `<p class="small">Sending as <b>${esc(me.name)}</b> (${esc(me.email)}).</p>` : `<label class="field">Full name<input name="name" autocomplete="name" required maxlength="120"></label>
        <label class="field">Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>`}
        <label class="field">Subject<input name="subject" required maxlength="140" placeholder="e.g. Reservation fee for BSIT"></label>
        <label class="field">Your question<textarea name="message" required maxlength="4000"></textarea></label>
        ${consentBox(consent?.purposes.inquiry)}
        <p class="form-error" role="alert" tabindex="-1"></p>
        <button class="btn primary" type="submit">Send question</button>
      </form></div></div>
      <dialog id="ticket-dialog" aria-labelledby="ticket-title"><h2 id="ticket-title">Question received</h2><p>Your ticket number</p><p class="ticket-code" id="ticket-code"></p><p id="ticket-due"></p><div class="btn-row"><button class="btn" id="copy-code" type="button">Copy number</button><a class="btn primary" id="ticket-track" href="/track">Track it</a></div></dialog>`)
    $('#ask-form').addEventListener('submit', (e) => {
      e.preventDefault()
      submitForm(e.target, async (d) => {
        const r = await api('/api/inquiries', { method: 'POST', body: d })
        const mail = known ? me.email : d.email
        sessionStorage.setItem('admit-last', JSON.stringify({ code: r.code, email: mail }))
        e.target.reset()
        $('#ticket-code').textContent = r.code
        $('#ticket-due').textContent = `Reply due by ${day(r.due)} (3 working days). An officer may reclassify complex questions.`
        $('#ticket-track').setAttribute('href', `/track?code=${encodeURIComponent(r.code)}&email=${encodeURIComponent(mail)}`)
        $('#ticket-dialog').showModal()
      })
    })
    $('#copy-code').addEventListener('click', () => navigator.clipboard.writeText($('#ticket-code').textContent).then(() => toast('Ticket number copied.')))
  }

  function track() {
    const q = new URLSearchParams(location.search)
    const last = JSON.parse(sessionStorage.getItem('admit-last') || 'null')
    const code = q.get('code') || last?.code || ''
    const mail = q.get('email') || last?.email || ''
    view(`<div class="auth"><div class="section"><h1>Track a ticket</h1>
      <form class="stack" id="track-form" novalidate>
        <div class="fields two"><label class="field">Ticket number<input name="code" required value="${esc(code)}" placeholder="ADM-2026-00001" autocapitalize="characters"></label>
        <label class="field">Email used<input name="email" type="email" required value="${esc(mail)}" autocomplete="email"></label></div>
        <p class="form-error" role="alert" tabindex="-1"></p>
        <button class="btn primary" type="submit">Check status</button>
      </form><div id="track-result" aria-live="polite"></div></div></div>`)
    const form = $('#track-form')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submitForm(form, async (d) => {
        const { ticket: t } = await api(`/api/inquiries/status?code=${encodeURIComponent(d.code)}&email=${encodeURIComponent(d.email)}`)
        $('#track-result').innerHTML = `<hr><h2>${esc(t.subject)}</h2><p>${statusChip(t)} <span class="chip">${esc(TIERS[t.tier])}</span></p>
          <p>Opened ${when(t.created_at)}${t.officer ? ` · Handled by ${esc(t.officer)}` : ' · Awaiting assignment'}</p>
          ${t.status === 'resolved' ? `<p><b>Reply:</b></p><div class="ticket-body">${esc(t.closing_remark)}</div>` : `<p>${t.sla.overdue ? 'This ticket is past its due date and has been raised to the school administrator.' : `Due by <b>${day(t.sla.due)}</b>. ${t.sla.remaining} working day${t.sla.remaining === 1 ? '' : 's'} left.`}</p>`}`
      })
    })
    if (code && mail) form.requestSubmit()
  }

  const statusChip = (t) => t.status === 'resolved' ? '<span class="chip ok">Resolved</span>' : t.sla?.overdue ? '<span class="chip bad">Overdue</span>' : '<span class="chip warn">Open</span>'

  function apply() {
    if (me) return go(me.role === 'applicant' ? '/me' : '/staff/applicants')
    view(`<div class="section" style="max-width:820px;margin:0 auto"><h1>Start your application</h1><p class="muted">One profile per person. Sensitive details are encrypted before they are stored.</p>
      <form class="stack" id="apply-form" novalidate>
        <fieldset><legend>About you</legend><div class="fields two">
          <label class="field">First name<input name="first_name" required autocomplete="given-name" maxlength="80"></label>
          <label class="field">Surname<input name="surname" required autocomplete="family-name" maxlength="80"></label>
          <label class="field">Date of birth<input name="dob" type="date" required autocomplete="bday"></label>
          <label class="field">Mobile number<input name="phone" type="tel" required autocomplete="tel" maxlength="20" placeholder="09XX XXX XXXX"></label>
        </div><label class="field" style="margin-top:14px">Home address<input name="address" required autocomplete="street-address" maxlength="300"></label>
        <label class="check"><input type="checkbox" name="filipino" checked> I am a Filipino citizen</label></fieldset>
        <fieldset><legend>What you're applying for</legend><div class="fields two">
          <label class="field">Level<select name="level" id="level" required><option value="College">College</option><option value="SHS">Senior High School</option></select></label>
          <label class="field">Program or strand<input name="program" required maxlength="120" placeholder="e.g. BS Information Technology"></label>
        </div>
          <label class="field shs-only" hidden style="margin-top:14px">Junior high school you completed<select name="jhsType"><option value="public">Public / DepEd JHS</option><option value="esc">Private JHS, ESC grantee</option><option value="private">Private JHS, not an ESC grantee</option></select></label>
          <div class="college-only"><label class="check"><input type="checkbox" name="priorDegree"> I already hold an undergraduate degree</label></div>
        </fieldset>
        <fieldset class="college-only"><legend>Financial aid screening <span class="muted small">(optional, used only to flag subsidies)</span></legend>
          <label class="field">Combined household gross income per year (PHP)<input name="householdIncome" type="number" min="0" step="1000" inputmode="numeric"><span class="hint">Tulong Dunong requires P400,000 or less.</span></label>
          <label class="check"><input type="checkbox" name="pwd"> I am a person with disability (PWD ID holder)</label>
          <label class="check"><input type="checkbox" name="listahanan"> My household is in Listahanan or 4Ps</label>
          <label class="check"><input type="checkbox" name="soloParentDependent"> I am a dependent of a solo parent</label>
          <label class="check"><input type="checkbox" name="indigenous"> I belong to an Indigenous Cultural Community</label>
          <label class="check"><input type="checkbox" name="otherGovGrant"> I already receive a national government scholarship or grant</label>
        </fieldset>
        <fieldset><legend>Your account</legend><div class="fields two">
          <label class="field">Email<input name="email" type="email" required autocomplete="email" maxlength="200"></label>
          <label class="field">Password<input name="password" type="password" required minlength="10" autocomplete="new-password"><span class="hint">At least 10 characters.</span></label>
        </div></fieldset>
        ${consentBox(consent?.purposes.application)}
        <p class="form-error" role="alert" tabindex="-1"></p>
        <button class="btn primary" type="submit">Create my application</button>
      </form></div>`)
    const sync = () => {
      const shs = $('#level').value === 'SHS'
      main.querySelectorAll('.shs-only').forEach((x) => (x.hidden = !shs))
      main.querySelectorAll('.college-only').forEach((x) => (x.hidden = shs))
    }
    $('#level').addEventListener('change', sync)
    sync()
    $('#apply-form').addEventListener('submit', (e) => {
      e.preventDefault()
      submitForm(e.target, async (d) => {
        await api('/api/auth/register', { method: 'POST', body: d })
        me = (await api('/api/me')).user
        toast('Application created.')
        go('/me')
      })
    })
  }

  function login() {
    view(`<div class="auth"><div class="section"><h1>Sign in</h1>
      <form class="stack" id="login-form" novalidate>
        <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
        <label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label>
        <p class="form-error" role="alert" tabindex="-1"></p>
        <button class="btn primary" type="submit">Sign in</button>
      </form><p class="small muted" style="margin-top:12px">New applicant? <a href="/apply">Start an application</a>.</p></div></div>`)
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault()
      submitForm(e.target, async (d) => {
        me = (await api('/api/auth/login', { method: 'POST', body: d })).user
        go(me.role === 'applicant' ? '/me' : me.role === 'dpo' ? '/staff/audit' : me.role === 'finaid' ? '/staff/aid' : has('officer', 'admin') ? '/staff/tickets' : '/staff/applicants')
      })
    })
  }

  function setup() {
    view(`<div class="auth"><div class="section"><h1>First-time setup</h1><p class="muted">Create the School Administrator account. This screen disappears once an administrator exists.</p>
      <form class="stack" id="setup-form" novalidate>
        <label class="field">Full name<input name="name" required autocomplete="name"></label>
        <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
        <label class="field">Password<input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
        <p class="form-error" role="alert" tabindex="-1"></p>
        <button class="btn primary" type="submit">Create administrator</button>
      </form></div></div>`)
    $('#setup-form').addEventListener('submit', (e) => {
      e.preventDefault()
      submitForm(e.target, async (d) => {
        await api('/api/setup', { method: 'POST', body: d })
        me = (await api('/api/me')).user
        go('/staff/users')
      })
    })
  }

  const stepper = (stage) => {
    const i = STAGES.findIndex(([k]) => k === stage)
    return `<ol class="stepper" aria-label="Application progress">${STAGES.map(([k, l], n) => `<li class="${n < i ? 'done' : n === i ? 'now' : ''}" ${n === i ? 'aria-current="step"' : ''}>${l}</li>`).join('')}</ol>`
  }
  const reqChip = (r) => r.status === 'received' ? '<span class="chip ok">Received</span>' : r.status === 'rejected' ? '<span class="chip bad">Rejected</span>' : r.overdue ? '<span class="chip bad">Overdue</span>' : '<span class="chip warn">Pending</span>'
  const matchCards = (matches, aid, canEndorse) => matches.length ? matches.map((m) => {
    const endorsed = aid.find((a) => a.program_code === m.code)
    return `<article class="match"><h3><span>${esc(m.name)}</span><span>${esc(m.amount)}</span></h3><p class="small">${esc(m.basis)}</p>
      <p class="small"><b>Documents:</b></p><ul class="small">${m.documents.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <p class="small muted">${esc(m.caveat)} <a href="${esc(m.source)}" target="_blank" rel="noopener">Source</a></p>
      ${endorsed ? `<span class="chip ok">Endorsed${endorsed.status !== 'endorsed' ? ' · ' + esc(endorsed.status) : ''}</span>` : canEndorse ? `<button class="btn" type="button" data-endorse="${esc(m.code)}">Endorse to coordinator</button>` : '<span class="chip">Not yet endorsed</span>'}</article>`
  }).join('') : '<p class="empty">No subsidy program matches this profile on the stated criteria.</p>'

  async function myApp() {
    if (!me) return go('/login')
    loading()
    const d = await api('/api/my')
    const a = d.applicant
    const received = d.requirements.filter((r) => r.status === 'received').length
    view(`<div class="page-head"><div><h1>Hi, ${esc(a.first_name)}</h1><p class="muted">${esc(a.level === 'SHS' ? 'Senior High School' : 'College')} · ${esc(a.program)}</p></div>
        <div class="btn-row"><a class="btn" href="/ask">Ask Admissions</a><a class="btn" href="/api/my/export" download>Download my data</a></div></div>
      <section class="section" aria-labelledby="prog-h"><h2 id="prog-h" class="sr-only">Progress</h2>${stepper(a.stage)}
        <p class="small muted">${received} of ${d.requirements.length} documents received · Reservation fee ${d.payment ? `validated (OR ${esc(d.payment.or_number)})` : 'not yet validated'}</p></section>
      ${d.notices.length ? `<section class="section" aria-labelledby="not-h"><h2 id="not-h">Notices</h2>${d.notices.map((n) => `<div class="notice"><p class="small muted">${when(n.created_at)}</p><p>${esc(n.body)}</p></div>`).join('')}</section>` : ''}
      <div class="grid-2">
        <section class="section" aria-labelledby="req-h"><h2 id="req-h">Requirements</h2><div class="table-wrap"><table><thead><tr><th>Document</th><th>Status</th><th>Due</th></tr></thead><tbody>
          ${d.requirements.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${reqChip(r)}</td><td>${day(r.deadline)}</td></tr>`).join('')}</tbody></table></div>
          <p class="small muted">Submit documents to the Registrar's Office. Pay the reservation fee through apply.sti.edu or the cashier; the cashier validates it with your official receipt number.</p></section>
        <section class="section" aria-labelledby="aid-h"><h2 id="aid-h">Subsidies you may qualify for</h2>${matchCards(d.matches, d.aid, false)}</section>
      </div>
      <section class="section" aria-labelledby="tix-h"><h2 id="tix-h">Your questions</h2>${d.tickets.length ? d.tickets.map((t) => `<details class="ticket"><summary><span><b>${esc(t.subject)}</b> <span class="mono muted">${esc(t.code)}</span></span>${t.status === 'resolved' ? '<span class="chip ok">Resolved</span>' : '<span class="chip warn">Open</span>'}</summary><div class="inner">${t.closing_remark ? `<div class="ticket-body">${esc(t.closing_remark)}</div>` : `<p class="muted">Waiting for a reply. <a href="/track?code=${encodeURIComponent(t.code)}&email=${encodeURIComponent(a.email)}">See due date</a></p>`}</div></details>`).join('') : '<p class="empty">No questions yet. <a href="/ask">Ask one</a>.</p>'}</section>
      <section class="section" aria-labelledby="priv-h"><h2 id="priv-h">Your data and consent</h2>${d.consents.map((x) => `<p class="small">Consent v${esc(x.statement_version)} given ${when(x.created_at)} for: ${esc(x.purpose)}</p>`).join('')}
        <p class="small muted">"Download my data" includes everything stored about you and a log of every staff member who opened your record, when, and why.</p></section>`)
  }

  async function applicants() {
    loading()
    const q = new URLSearchParams(location.search)
    const d = await api(`/api/applicants?${q}`)
    view(`<div class="page-head"><div><h1>Applicants</h1><p class="muted">Opening a record asks for a purpose; every access is logged.</p></div>
        ${has('registrar', 'officer', 'admin') ? '<button class="btn" id="run-notices" type="button">Issue overdue notices now</button>' : ''}</div>
      <section class="section"><form class="btn-row" id="filter-form" role="search">
        <label class="sr-only" for="q">Search</label><input id="q" name="q" value="${esc(q.get('q') || '')}" placeholder="Search name, email or program" style="flex:1;min-width:200px">
        <label class="sr-only" for="stage">Stage</label><select id="stage" name="stage" style="width:auto"><option value="">All stages</option>${STAGES.map(([k, l]) => `<option value="${k}" ${q.get('stage') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" type="submit">Filter</button></form>
      ${d.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Level / program</th><th>Stage</th><th>Documents</th><th>Applied</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr class="clickable" data-open="${r.id}" tabindex="0"><td><b>${esc(r.surname)}, ${esc(r.first_name)}</b><div class="small muted">${esc(r.email)}</div></td><td>${esc(r.level)} · ${esc(r.program)}</td><td>${esc(STAGES.find(([k]) => k === r.stage)[1])}</td>
          <td>${r.pending === 0 ? '<span class="chip ok">Complete</span>' : r.overdue ? `<span class="chip bad">${r.overdue} overdue</span>` : `<span class="chip warn">${r.pending} pending</span>`}</td><td>${day(r.created_at)}</td></tr>`).join('')}</tbody></table></div>
        <div class="btn-row" style="margin-top:12px">${d.page > 1 ? `<button class="btn" data-page="${d.page - 1}" type="button">Previous</button>` : ''}${d.more ? `<button class="btn" data-page="${d.page + 1}" type="button">Next</button>` : ''}</div>` : '<p class="empty">No applicants match.</p>'}</section>
      <dialog id="purpose-dialog" aria-labelledby="purpose-title"><form class="stack" id="purpose-form" method="dialog"><h2 id="purpose-title">Why are you opening this record?</h2>
        <label class="field">Purpose<select name="purpose" id="purpose-sel"><option>Validate reservation fee payment</option><option>Update requirement compliance</option><option>Screen or endorse financial aid</option><option>Answer the applicant's inquiry</option><option value="other">Other (type below)</option></select></label>
        <label class="field">Other purpose<input name="other" id="purpose-other" maxlength="200"></label>
        <div class="btn-row"><button class="btn primary" type="submit" value="ok">Open record</button><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button></div></form></dialog>`)
    $('#filter-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const f = formData(e.target)
      go(`/staff/applicants?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`)
    })
    $('#run-notices')?.addEventListener('click', async () => {
      const r = await api('/api/notices/run', { method: 'POST' })
      toast(r.issued ? `${r.issued} deficiency notice${r.issued === 1 ? '' : 's'} issued.` : 'No new notices needed.')
    })
    main.addEventListener('click', (e) => {
      const p = e.target.closest('[data-page]')
      if (p) { q.set('page', p.dataset.page); go(`/staff/applicants?${q}`) }
    })
    const dlg = $('#purpose-dialog')
    let target = null
    const open = (id) => { target = id; dlg.showModal() }
    main.querySelectorAll('[data-open]').forEach((tr) => {
      tr.addEventListener('click', () => open(tr.dataset.open))
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(tr.dataset.open) } })
    })
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return
      const sel = $('#purpose-sel').value
      const purpose = sel === 'other' ? $('#purpose-other').value.trim() : sel
      if (purpose.length < 5) return toast('Enter a purpose of at least 5 characters.', true)
      sessionStorage.setItem('admit-purpose', purpose)
      go(`/staff/applicants/${target}`)
    })
  }

  async function applicantDetail(id) {
    const purpose = sessionStorage.getItem('admit-purpose')
    if (!purpose) return go('/staff/applicants')
    loading()
    const d = await api(`/api/applicants/${id}?purpose=${encodeURIComponent(purpose)}`)
    const a = d.applicant
    const p = d.profile
    const canReq = has('registrar', 'officer', 'admin')
    view(`<p><a href="/staff/applicants">← Applicants</a></p>
      <div class="page-head"><div><h1>${esc(a.surname)}, ${esc(a.first_name)}</h1><p class="muted">${esc(a.level)} · ${esc(a.program)} · ${esc(a.email)} · Access logged as "${esc(purpose)}"</p></div>
        ${has('registrar', 'admin') && a.stage === 'complete' ? '<button class="btn primary" id="enroll-btn" type="button">Mark enrolled</button>' : ''}</div>
      <section class="section">${stepper(a.stage)}</section>
      <div class="grid-2">
        <section class="section" aria-labelledby="req-h"><h2 id="req-h">Requirement compliance</h2><div class="table-wrap"><table><thead><tr><th>Document</th><th>Status</th><th>Due</th>${canReq ? '<th><span class="sr-only">Update</span></th>' : ''}</tr></thead><tbody>
          ${d.requirements.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<div class="small muted">${esc(r.note)}</div>` : ''}</td><td>${reqChip(r)}</td><td>${day(r.deadline)}</td>
          ${canReq ? `<td><label class="sr-only" for="rq${r.id}">Set status for ${esc(r.label)}</label><select id="rq${r.id}" data-req="${r.id}" style="width:auto"><option value="">Set…</option><option value="received">Received</option><option value="pending">Pending</option><option value="rejected">Rejected</option></select></td>` : ''}</tr>`).join('')}</tbody></table></div>
          ${canReq ? `<form class="stack" id="notice-form" style="margin-top:16px"><label class="field">Send a written notice<textarea name="body" maxlength="2000" required placeholder="e.g. Your PSA birth certificate scan is unreadable. Please bring the original."></textarea></label><button class="btn" type="submit">Send notice</button></form>` : ''}
        </section>
        <div>
          <section class="section" aria-labelledby="pay-h"><h2 id="pay-h">Reservation fee</h2>
            ${d.payment ? `<p><span class="chip ok">Validated</span> ${peso(d.payment.amount)} · OR <span class="mono">${esc(d.payment.or_number)}</span> · ${when(d.payment.validated_at)}</p>` : has('cashier', 'admin') ? `<form class="stack" id="pay-form" novalidate><div class="fields two"><label class="field">Official receipt number<input name="or_number" required maxlength="40"></label><label class="field">Amount (PHP)<input name="amount" type="number" min="1" step="0.01" required inputmode="decimal"></label></div><p class="form-error" role="alert" tabindex="-1"></p><button class="btn primary" type="submit">Validate payment</button></form>` : '<p class="muted">Not yet validated by the cashier.</p>'}
          </section>
          <section class="section" aria-labelledby="prof-h"><h2 id="prof-h">Profile</h2><table><tbody>
            <tr><th>Date of birth</th><td>${day(p.dob)}</td></tr><tr><th>Mobile</th><td>${esc(p.phone)}</td></tr><tr><th>Address</th><td>${esc(p.address)}</td></tr>
            <tr><th>Citizenship</th><td>${p.filipino ? 'Filipino' : 'Non-Filipino'}</td></tr>
            ${p.level === 'SHS' ? `<tr><th>JHS type</th><td>${esc({ public: 'Public', esc: 'Private, ESC grantee', private: 'Private, non-ESC' }[p.jhsType])}</td></tr>` : `<tr><th>Household income</th><td>${p.householdIncome != null ? peso(p.householdIncome) : 'Not given'}</td></tr>`}
          </tbody></table></section>
        </div>
      </div>
      <section class="section" aria-labelledby="aid-h"><h2 id="aid-h">Financial aid screening</h2>${matchCards(d.matches, d.aid, has('finaid', 'admin'))}</section>
      ${d.notices.length ? `<section class="section"><h2>Notices sent</h2>${d.notices.map((n) => `<div class="notice"><p class="small muted">${when(n.created_at)}</p><p>${esc(n.body)}</p></div>`).join('')}</section>` : ''}`)
    const reload = () => applicantDetail(id)
    main.querySelectorAll('[data-req]').forEach((s) => s.addEventListener('change', async () => {
      if (!s.value) return
      let note = null
      if (s.value === 'rejected') { note = prompt('Reason for rejecting this document (shown to the applicant):'); if (!note) { s.value = ''; return } }
      try { await api(`/api/requirements/${s.dataset.req}`, { method: 'PATCH', body: { status: s.value, note } }); toast('Requirement updated.'); reload() } catch (e) { toast(e.message, true); s.value = '' }
    }))
    $('#notice-form')?.addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, async (f) => { await api(`/api/applicants/${id}/notice`, { method: 'POST', body: f }); toast('Notice sent.'); reload() }) })
    $('#pay-form')?.addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, async (f) => { await api(`/api/applicants/${id}/payment`, { method: 'POST', body: f }); toast('Payment validated.'); reload() }) })
    $('#enroll-btn')?.addEventListener('click', async () => { try { await api(`/api/applicants/${id}/stage`, { method: 'PATCH', body: { stage: 'enrolled' } }); toast('Marked enrolled.'); reload() } catch (e) { toast(e.message, true) } })
    main.querySelectorAll('[data-endorse]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/aid/endorse', { method: 'POST', body: { applicant_id: Number(id), program_code: b.dataset.endorse } }); toast('Endorsed to the financial aid coordinator.'); reload() } catch (e) { toast(e.message, true) }
    }))
  }

  async function tickets() {
    const q = new URLSearchParams(location.search)
    const status = q.get('status') === 'resolved' ? 'resolved' : 'open'
    const mine = q.get('mine') === '1'
    loading()
    const d = await api(`/api/tickets?status=${status}${mine ? '&mine=1' : ''}`)
    const tabs = [['open', false, 'Open'], ['open', true, 'Assigned to me'], ['resolved', false, 'Resolved']]
    view(`<div class="page-head"><div><h1>Inquiry tickets</h1><p class="muted">Oldest first. Working days exclude weekends and the holidays in the calendar.</p></div></div>
      <section class="section"><div class="tabs" role="tablist">${tabs.map(([s, m, l]) => `<button role="tab" type="button" aria-selected="${s === status && m === mine}" data-tab="${s}|${m ? 1 : 0}">${l}</button>`).join('')}</div>
      ${d.rows.length ? d.rows.map((t) => `<details class="ticket" data-id="${t.id}"><summary><span><b>${esc(t.subject)}</b> <span class="mono muted small">${esc(t.code)}</span><br><span class="small muted">${esc(t.name)} · ${when(t.created_at)} · ${esc(t.assignee || 'Unassigned')}</span></span>
          <span>${statusChip(t)} <span class="chip">${t.sla.elapsed}/${t.sla.ceiling} days</span></span></summary>
        <div class="inner"><div class="ticket-body">${esc(t.message)}</div><p class="small">From ${esc(t.email)}${t.escalated_at ? ` · <b>Escalated</b> ${when(t.escalated_at)}` : ''}</p>
          ${t.status === 'open' ? `<div class="fields two"><label class="field">Owner<select data-assign="${t.id}"><option value="">Unassigned</option>${d.officers.map((o) => `<option value="${o.id}" ${o.id === t.assignee_id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
            <label class="field">Service tier<select data-tier="${t.id}">${Object.entries(TIERS).map(([k, l]) => `<option value="${k}" ${k === t.tier ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
            <form class="stack" data-resolve="${t.id}"><label class="field">Closing remark (sent to the applicant)<textarea name="remark" required minlength="5" maxlength="2000"></textarea></label><p class="form-error" role="alert" tabindex="-1"></p><button class="btn primary" type="submit">Resolve ticket</button></form>`
          : `<p><b>Closing remark</b> (${when(t.resolved_at)}):</p><div class="ticket-body">${esc(t.closing_remark)}</div>`}</div></details>`).join('') : `<p class="empty">${status === 'open' ? 'No open tickets. Nice.' : 'No resolved tickets yet.'}</p>`}</section>`)
    main.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { const [s, m] = b.dataset.tab.split('|'); go(`/staff/tickets?status=${s}${m === '1' ? '&mine=1' : ''}`) }))
    main.querySelectorAll('[data-assign]').forEach((s) => s.addEventListener('change', async () => { if (!s.value) return; try { await api(`/api/tickets/${s.dataset.assign}`, { method: 'PATCH', body: { assignee_id: Number(s.value) } }); toast('Owner set.') } catch (e) { toast(e.message, true) } }))
    main.querySelectorAll('[data-tier]').forEach((s) => s.addEventListener('change', async () => { try { await api(`/api/tickets/${s.dataset.tier}`, { method: 'PATCH', body: { tier: s.value } }); toast('Tier updated.'); tickets() } catch (e) { toast(e.message, true) } }))
    main.querySelectorAll('[data-resolve]').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); submitForm(f, async (x) => { await api(`/api/tickets/${f.dataset.resolve}/resolve`, { method: 'POST', body: x }); toast('Ticket resolved.'); tickets() }) }))
  }

  async function aidQueue() {
    loading()
    const d = await api('/api/aid/queue')
    view(`<div class="page-head"><div><h1>Financial aid queue</h1><p class="muted">Cases endorsed from applicant screening, with the documents each program requires.</p></div></div>
      <section class="section">${d.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Program</th><th>Documents</th><th>Status</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td><b>${esc(r.surname)}, ${esc(r.first_name)}</b><div class="small muted">Endorsed ${day(r.endorsed_at)}</div></td><td>${esc(r.program_name)}<div class="small muted">${esc(r.amount)}</div></td>
          <td><ul class="small" style="margin:0;padding-left:18px">${r.documents.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></td>
          <td><label class="sr-only" for="ax${r.id}">Status</label><select id="ax${r.id}" data-aid="${r.id}" style="width:auto">${['endorsed', 'submitted', 'approved', 'denied'].map((s) => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No endorsed cases yet. Open an applicant and endorse a matching program.</p>'}</section>`)
    main.querySelectorAll('[data-aid]').forEach((s) => s.addEventListener('change', async () => { try { await api(`/api/aid/${s.dataset.aid}`, { method: 'PATCH', body: { status: s.value } }); toast('Status updated.') } catch (e) { toast(e.message, true) } }))
  }

  async function escalations() {
    loading()
    const d = await api('/api/escalations')
    view(`<div class="page-head"><div><h1>Escalations</h1><p class="muted">Open tickets past their service tier ceiling, raised automatically.</p></div></div>
      <section class="section">${d.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Ticket</th><th>From</th><th>Owner</th><th>Working days</th><th>Escalated</th></tr></thead><tbody>
        ${d.rows.map((t) => `<tr><td><b>${esc(t.subject)}</b><div class="mono small muted">${esc(t.code)}</div></td><td>${esc(t.name)}</td><td>${esc(t.assignee || 'Unassigned')}</td><td><span class="chip bad">${t.sla.elapsed} / ${t.sla.ceiling}</span></td><td>${when(t.escalated_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing overdue.</p>'}
        <p class="small"><a href="/staff/tickets">Go to the ticket queue</a> to assign or resolve.</p></section>`)
  }

  const defaultRange = () => {
    const to = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
    const f = new Date(Date.now() + 8 * 3600e3 - 29 * 86400e3).toISOString().slice(0, 10)
    return [f, to]
  }

  async function analytics() {
    const q = new URLSearchParams(location.search)
    const [df, dt] = defaultRange()
    const from = q.get('from') || df
    const to = q.get('to') || dt
    loading()
    const d = await api(`/api/analytics?from=${from}&to=${to}`)
    const pct = (n, of) => (of ? Math.round((n / of) * 100) + '%' : 'n/a')
    const maxAging = Math.max(1, ...d.aging.map((x) => x.count))
    const f = d.funnel
    view(`<div class="page-head"><div><h1>Admissions analytics</h1><p class="muted">${day(from)} to ${day(to)}, Manila time.</p></div>
        <div class="btn-row"><a class="btn" href="/api/analytics.csv?from=${from}&to=${to}" download>Export cases (CSV)</a><button class="btn" type="button" id="print-btn">Print</button></div></div>
      <form class="btn-row section" id="range-form"><label class="field">From<input type="date" name="from" value="${from}"></label><label class="field">To<input type="date" name="to" value="${to}"></label><button class="btn" type="submit" style="align-self:end">Apply</button></form>
      <div class="kpis">
        <div class="kpi"><b>${d.volume.total}</b><span>inquiries received</span></div>
        <div class="kpi"><b>${d.volume.open}</b><span>still open</span></div>
        <div class="kpi"><b>${pct(d.sla.resolvedWithin, d.volume.resolved)}</b><span>resolved within tier (${d.sla.resolvedWithin} of ${d.volume.resolved})</span></div>
        <div class="kpi"><b>${d.sla.openOverdue}</b><span>open and overdue</span></div>
        <div class="kpi"><b>${d.sla.medianResolutionDays ?? 'n/a'}</b><span>median working days to resolve</span></div>
      </div>
      <div class="grid-2">
        <section class="section"><h2>Stage conversion</h2><p class="small muted">Applicants who registered in this range, by furthest stage reached.</p><div class="bars">
          ${[['Applied', f.applicants], ['Fee validated', f.reserved], ['Docs complete', f.complete], ['Enrolled', f.enrolled]].map(([l, n]) => `<div class="bar"><span>${l}</span><span class="track"><span class="fill" style="width:${f.applicants ? (n / f.applicants) * 100 : 0}%"></span></span><b>${n}</b></div>`).join('')}
          </div><p class="small muted" style="margin-top:8px">Applied → enrolled: ${pct(f.enrolled, f.applicants)}</p></section>
        <section class="section"><h2>Open case aging</h2><p class="small muted">Working days since each open ticket arrived.</p><div class="bars">
          ${d.aging.map((x) => `<div class="bar"><span>${x.label} days</span><span class="track"><span class="fill ${x.label === '0-1' || x.label === '2-3' ? '' : 'warn'}" style="width:${(x.count / maxAging) * 100}%"></span></span><b>${x.count}</b></div>`).join('')}</div></section>
      </div>`)
    $('#range-form').addEventListener('submit', (e) => { e.preventDefault(); const r = formData(e.target); go(`/staff/analytics?from=${r.from}&to=${r.to}`) })
    $('#print-btn').addEventListener('click', () => print())
  }

  async function auditLog() {
    const q = new URLSearchParams(location.search)
    const [df, dt] = defaultRange()
    const from = q.get('from') || df
    const to = q.get('to') || dt
    loading()
    const d = await api(`/api/audit?from=${from}&to=${to}`)
    view(`<div class="page-head"><div><h1>Personal data access log</h1><p class="muted">Who opened or changed which applicant record, when, and for what stated purpose.</p></div>
        <a class="btn" href="/api/audit.csv?from=${from}&to=${to}" download>Export (CSV)</a></div>
      <form class="btn-row section" id="range-form"><label class="field">From<input type="date" name="from" value="${from}"></label><label class="field">To<input type="date" name="to" value="${to}"></label><button class="btn" type="submit" style="align-self:end">Apply</button></form>
      <section class="section">${d.rows.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>User</th><th>Applicant</th><th>Action</th><th>Purpose</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td class="small">${when(r.created_at)}</td><td>${esc(r.user_name)}<div class="small muted">${esc(ROLE_LABEL[r.role] || '')}</div></td><td>${esc(r.applicant || '')}</td><td><span class="chip">${esc(r.action)}</span></td><td>${esc(r.purpose)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No access recorded in this range.</p>'}</section>`)
    $('#range-form').addEventListener('submit', (e) => { e.preventDefault(); const r = formData(e.target); go(`/staff/audit?from=${r.from}&to=${r.to}`) })
  }

  async function users() {
    loading()
    const [u, h] = await Promise.all([api('/api/users'), api('/api/holidays')])
    view(`<div class="page-head"><div><h1>Staff & calendar</h1></div></div>
      <div class="grid-2">
        <section class="section"><h2>Staff accounts</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>
          ${u.rows.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.email)}</div></td><td>${esc(ROLE_LABEL[r.role])}</td><td>${r.id === me.id ? '<span class="chip ok">You</span>' : `<button class="btn ${r.active ? 'danger' : ''}" type="button" data-toggle="${r.id}" data-active="${r.active}">${r.active ? 'Deactivate' : 'Reactivate'}</button>`}</td></tr>`).join('')}</tbody></table></div>
          <form class="stack" id="user-form" novalidate style="margin-top:16px"><h3>Add staff</h3><div class="fields two">
            <label class="field">Full name<input name="name" required></label><label class="field">Email<input name="email" type="email" required autocomplete="off"></label>
            <label class="field">Role<select name="role">${Object.entries(ROLE_LABEL).filter(([k]) => k !== 'applicant').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
            <label class="field">Temporary password<input name="password" type="password" required minlength="10" autocomplete="new-password"></label></div>
            <p class="form-error" role="alert" tabindex="-1"></p><button class="btn primary" type="submit">Add staff</button></form></section>
        <section class="section"><h2>Non-working days</h2><p class="small muted">Weekends are excluded automatically. Add declared holidays and class suspensions here; the service clock skips them.</p>
          ${h.rows.length ? `<table><tbody>${h.rows.map((r) => `<tr><td>${day(r.day)}</td><td>${esc(r.label)}</td><td><button class="btn ghost danger" type="button" data-del="${r.day}" aria-label="Remove ${esc(r.label)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No holidays added.</p>'}
          <form class="stack" id="hol-form" novalidate style="margin-top:12px"><div class="fields two"><label class="field">Date<input name="day" type="date" required></label><label class="field">Name<input name="label" required maxlength="120"></label></div>
            <p class="form-error" role="alert" tabindex="-1"></p><button class="btn" type="submit">Add day</button></form></section>
      </div>`)
    $('#user-form').addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, async (f) => { await api('/api/users', { method: 'POST', body: f }); toast('Staff account added.'); users() }) })
    $('#hol-form').addEventListener('submit', (e) => { e.preventDefault(); submitForm(e.target, async (f) => { await api('/api/holidays', { method: 'POST', body: f }); toast('Holiday saved.'); users() }) })
    main.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/users/${b.dataset.toggle}`, { method: 'PATCH', body: { active: b.dataset.active !== '1' } }); users() }))
    main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/holidays/${b.dataset.del}`, { method: 'DELETE' }); users() }))
  }

  const guard = (fn, ...roles) => async (...a) => {
    if (!me) return go('/login')
    if (!roles.includes(me.role)) return view('<div class="section empty"><h1>Not available for your role</h1><p><a href="/">Go home</a></p></div>')
    return fn(...a)
  }

  const routes = [
    [/^\/$/, home],
    [/^\/ask$/, ask],
    [/^\/track$/, track],
    [/^\/apply$/, apply],
    [/^\/login$/, login],
    [/^\/setup$/, setup],
    [/^\/me$/, guard(myApp, 'applicant')],
    [/^\/staff\/applicants$/, guard(applicants, 'officer', 'registrar', 'cashier', 'finaid', 'admin')],
    [/^\/staff\/applicants\/(\d+)$/, guard(applicantDetail, 'officer', 'registrar', 'cashier', 'finaid', 'admin')],
    [/^\/staff\/tickets$/, guard(tickets, 'officer', 'admin')],
    [/^\/staff\/aid$/, guard(aidQueue, 'finaid', 'admin')],
    [/^\/staff\/escalations$/, guard(escalations, 'admin')],
    [/^\/staff\/analytics$/, guard(analytics, 'admin')],
    [/^\/staff\/audit$/, guard(auditLog, 'dpo', 'admin')],
    [/^\/staff\/users$/, guard(users, 'admin')]
  ]

  async function route() {
    nav()
    const path = location.pathname
    for (const [re, fn] of routes) {
      const m = path.match(re)
      if (m) {
        try {
          await fn(...m.slice(1))
        } catch (e) {
          if (e.status === 401) { me = null; nav(); return go('/login') }
          view(`<div class="section"><h1>Couldn't load this page</h1><p class="form-error">${esc(e.message)}</p><button class="btn" type="button" id="retry">Try again</button></div>`)
          $('#retry').addEventListener('click', route)
        }
        return
      }
    }
    view('<div class="section empty"><h1>Page not found</h1><p><a href="/">Go home</a></p></div>')
  }

  ;(async () => {
    try {
      const [m, cst, s] = await Promise.all([api('/api/me'), api('/api/consent'), api('/api/setup')])
      me = m.user
      consent = cst
      if (s.needed && location.pathname !== '/setup') history.replaceState({}, '', '/setup')
    } catch (e) {
      toast(e.message, true)
    }
    route()
  })()
})()
