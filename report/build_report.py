import json
from PIL import Image, ImageOps
from docx import Document
from docx.shared import Pt, Cm, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = '/home/user/webapp'
FIG = f'{ROOT}/report/figures'
OUT = f'{ROOT}/report/ADMIT-Lipa_Prototype_Progress_Report.docx'
FONT = 'Times New Roman'
SCHOOL = 'STI College Lipa'
TEXT_W_IN = 6.0
TABLE_W_CM = 15.2
MAX_FIG_H_IN = 6.6
CENTER, LEFT, JUSTIFY = WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.JUSTIFY

test = json.load(open(f'{ROOT}/report/test_summary.json'))
video = json.load(open(f'{ROOT}/report/video_summary.json'))

doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.left_margin = Inches(1.5)
sec.right_margin = sec.top_margin = sec.bottom_margin = Inches(1)
sec.header_distance = sec.footer_distance = Inches(0.5)
sec.different_first_page_header_footer = True


def style_font(style, size=12, bold=None, italic=None):
    style.font.name = FONT
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    if bold is not None:
        style.font.bold = bold
    if italic is not None:
        style.font.italic = italic
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.insert(0, rfonts)
    for a in ('w:asciiTheme', 'w:hAnsiTheme', 'w:eastAsiaTheme', 'w:cstheme'):
        rfonts.attrib.pop(qn(a), None)
    for a in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
        rfonts.set(qn(a), FONT)
    color = rpr.find(qn('w:color'))
    if color is not None:
        for a in ('w:themeColor', 'w:themeShade', 'w:themeTint'):
            color.attrib.pop(qn(a), None)


normal = doc.styles['Normal']
style_font(normal)
normal.paragraph_format.line_spacing = 1.5
normal.paragraph_format.space_before = Pt(0)
normal.paragraph_format.space_after = Pt(0)
for name, align in (('Heading 1', CENTER), ('Heading 2', LEFT)):
    st = doc.styles[name]
    style_font(st, 12, bold=True, italic=False)
    pf = st.paragraph_format
    pf.alignment = align
    pf.line_spacing = 1.5
    pf.space_before = Pt(12)
    pf.space_after = Pt(0)
    pf.keep_with_next = True
style_font(doc.styles['Footer'])


def add_field(p, instr):
    def fld(kind):
        r = p.add_run()
        el = OxmlElement('w:fldChar')
        el.set(qn('w:fldCharType'), kind)
        r._r.append(el)
    fld('begin')
    r = p.add_run()
    it = OxmlElement('w:instrText')
    it.set(qn('xml:space'), 'preserve')
    it.text = instr
    r._r.append(it)
    fld('separate')
    p.add_run('2')
    fld('end')


fp = sec.footer.paragraphs[0]
fp.paragraph_format.line_spacing = 1.0
fp.paragraph_format.first_line_indent = Inches(0)
for pos in (3.25, 6.5):
    fp.paragraph_format.tab_stops.add_tab_stop(Inches(pos), WD_TAB_ALIGNMENT.CLEAR)
fp.paragraph_format.tab_stops.add_tab_stop(Inches(TEXT_W_IN), WD_TAB_ALIGNMENT.RIGHT)
fp.add_run(SCHOOL)
fp.add_run('\t')
add_field(fp, 'PAGE')


def para(parts, indent=True, align=JUSTIFY, spacing=1.5, before=0, after=0, keep=False, hanging=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    p.alignment = align
    pf.line_spacing = spacing
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.keep_with_next = keep
    if hanging:
        pf.left_indent = Inches(0.5)
        pf.first_line_indent = Inches(-0.5)
    else:
        pf.first_line_indent = Inches(0.5) if indent else Inches(0)
    for part in ([parts] if isinstance(parts, str) else parts):
        if isinstance(part, tuple):
            r = p.add_run(part[0])
            r.bold = 'b' in part[1]
            r.italic = 'i' in part[1]
        else:
            p.add_run(part)
    return p


def center(text, bold=False, after=0):
    return para([(text, 'b' if bold else '')], indent=False, align=CENTER, spacing=1.0, after=after)


def heading(text, level=1):
    return doc.add_heading(text, level)


def border(tag, edges):
    b = OxmlElement(tag)
    for edge, on in edges:
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single' if on else 'nil')
        if on:
            e.set(qn('w:sz'), '8')
            e.set(qn('w:space'), '0')
            e.set(qn('w:color'), '000000')
        b.append(e)
    return b


def row_flag(row, tag):
    el = OxmlElement(tag)
    el.set(qn('w:val'), 'true')
    row._tr.get_or_add_trPr().append(el)


def cell_text(cell, text, bold=False):
    cell.text = ''
    p = cell.paragraphs[0]
    p.alignment = LEFT
    pf = p.paragraph_format
    pf.line_spacing = 1.0
    pf.first_line_indent = Inches(0)
    pf.space_before = Pt(2)
    pf.space_after = Pt(2)
    r = p.add_run(text)
    r.bold = bold


def apa_table(num, title, headers, rows, widths, inside=False, row_h=None):
    para([(f'Table {num}', 'b')], indent=False, align=LEFT, spacing=1.0, before=12, keep=True)
    para([(title, 'i')], indent=False, align=LEFT, spacing=1.0, after=6, keep=True)
    scale = TABLE_W_CM / sum(widths)
    widths = [w * scale for w in widths]
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    tblPr = t._tbl.tblPr
    lay = OxmlElement('w:tblLayout')
    lay.set(qn('w:type'), 'fixed')
    tblPr.append(lay)
    tblPr.append(border('w:tblBorders', [('top', True), ('left', False), ('bottom', True), ('right', False), ('insideH', inside), ('insideV', False)]))
    for i, gc in enumerate(t._tbl.tblGrid.findall(qn('w:gridCol'))):
        gc.set(qn('w:w'), str(int(widths[i] * 567)))
    hdr = t.rows[0]
    row_flag(hdr, 'w:tblHeader')
    for i, h in enumerate(headers):
        cell_text(hdr.cells[i], h, bold=True)
        hdr.cells[i]._tc.get_or_add_tcPr().append(border('w:tcBorders', [('bottom', True)]))
    for data in rows:
        row = t.add_row()
        row_flag(row, 'w:cantSplit')
        if row_h:
            row.height = Cm(row_h)
        for i, v in enumerate(data):
            cell_text(row.cells[i], str(v))
    for row in t.rows:
        for i, w in enumerate(widths):
            row.cells[i].width = Cm(w)
    para('', indent=False, spacing=1.0)
    return t


def apa_figure(num, title, file, note):
    para([(f'Figure {num}', 'b')], indent=False, align=LEFT, spacing=1.0, before=12, keep=True)
    para([(title, 'i')], indent=False, align=LEFT, spacing=1.0, after=6, keep=True)
    src = Image.open(f'{FIG}/{file}').convert('RGB')
    framed = ImageOps.expand(src, border=max(2, src.width // 600), fill='#7f7f7f')
    tmp = f'/tmp/framed-{file}'
    framed.save(tmp)
    width_in = min(TEXT_W_IN, MAX_FIG_H_IN * framed.width / framed.height)
    p = doc.add_paragraph()
    p.alignment = CENTER
    p.paragraph_format.line_spacing = 1.0
    p.paragraph_format.first_line_indent = Inches(0)
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(tmp, width=Inches(width_in))
    para([('Note.', 'i'), ' ' + note], indent=False, align=JUSTIFY, spacing=1.0, before=6, after=12)


for line in ['ADMIT-LIPA:', 'A WEB-BASED ADMISSIONS CUSTOMER RELATIONSHIP', 'MANAGEMENT SYSTEM FOR THE ADMISSIONS OFFICE', 'OF STI COLLEGE LIPA']:
    center(line, True)
center('', after=24)
center('STI College Lipa', True)
center('C. M. Recto Avenue, Barangay 6, Lipa City, Batangas')
center('School of Information and Communications Technology', after=48)
center('Prototype Progress Report', True, after=48)
center('Presented in Partial Fulfillment of the Requirements in')
center('Application Development and Emerging Technologies', after=48)
center('Submitted by the Proponents:', True)
for n in ['Atienza, Kurt Judd P.', 'Garonia, Ian Humprey M.', 'Apura, Alexis H.', 'Tenedo, Francis Gerald G.']:
    center(n)
center('', after=24)
center('Submitted to:', True)
center('Ms. Gabrielle Hernandez')
center('Course Facilitator', after=48)
center('First Semester, School Year 2026-2027')
center('October 28, 2026')
doc.add_page_break()

heading('Summary of Progress')
para('The proponents moved ADMIT-Lipa from the approved System Concept Proposal to a working web application for the Admissions Office of STI College Lipa. '
     'The system replaces the current practice in which applicants send a screenshot of their proof of payment to the campus Facebook Messenger account for validation (STI Education Services Group, n.d.). '
     'All fourteen use cases in the use-case diagram of the proposal now run end to end in the development build, '
     f'and the automated acceptance test suite passed {test["passed"]} of {test["total"]} checks on October 28, 2026. '
     'Each functional requirement, FR-01 to FR-14, is exercised by at least one check that follows the verification method written in the proposal. '
     'Table 1 summarizes the status of the prototype.')
apa_table(1, 'Prototype Status as of October 28, 2026', ['Item', 'Status'], [
    ['Use cases implemented', '14 of 14 (UC1 to UC14)'],
    ['Functional requirements verified by automated test', '14 of 14 (FR-01 to FR-14)'],
    ['Non-functional requirements verified', 'NFR-02 and NFR-03 (in part) by automated test; NFR-05 checked at a 390-pixel viewport, with the 360-pixel check stated in the proposal still pending'],
    ['Screens designed and captured', '13 screens in desktop (1920 × 1080) and mobile (390 × 844) sizes'],
    ['Source code', 'https://github.com/Tiredicey/APPDEV'],
    ['Deployment', 'Runs in the development environment; public hosting on Cloudflare Pages is the next step'],
], [7, 9])

heading('Technology Used')
para('The proponents built the prototype on the technologies listed in Table 2. '
     'Each choice keeps hosting costs low for the campus and protects the personal data that applicants submit.')
apa_table(2, 'Technology Stack of the Prototype', ['Layer', 'Choice', 'Reason'], [
    ['Server', 'Hono web framework on Cloudflare Workers and Pages', 'Runs at the network edge; no server for the campus to maintain'],
    ['Database', 'Cloudflare D1 (SQLite)', 'Relational tables for tickets, requirements, payments, and the audit log; D1 encrypts data at rest and in transit (Cloudflare, 2026)'],
    ['Field encryption', 'AES-256-GCM through the Web Crypto API', 'Date of birth, mobile number, address, and financial aid answers are encrypted before they reach the database (NFR-03)'],
    ['Passwords', 'PBKDF2-SHA-256, 100,000 iterations, per-user salt', 'No plain-text passwords are stored'],
    ['Front end', 'Plain JavaScript single-page application', 'Small download for mobile users on slow connections'],
    ['Development assistant', 'Genspark AI coding agent', "Generated code, tests, and the background video under the proponents' direction; the team reviewed the screens and tested the prototype"],
], [3.2, 5, 7.8])

heading('Requirement Traceability')
para('Table 3 lists each functional requirement, the use case it traces to, the behavior implemented in the prototype, and the result of its automated verification.')
apa_table(3, 'Functional Requirements Implemented and Verified', ['Req.', 'Use Case', 'Implemented Behavior', 'Result'], [
    ['FR-01', 'UC1', 'The inquiry form returns a ticket number such as ADM-2026-00001 in the same session and stores it', 'Pass'],
    ['FR-02', 'UC2', 'A second profile with the same surname, first name, and date of birth is blocked with a message; the check works on encrypted data through a keyed index', 'Pass'],
    ['FR-03', 'UC3', 'Each required document shows received, pending, or rejected; a rejection requires a reason', 'Pass'],
    ['FR-04', 'UC4', 'TES, TES-3A, and TDP (Unified Student Financial Assistance System for Tertiary Education, n.d.) and the SHS Voucher (Department of Education, n.d.) are flagged from the encoded profile; the income ceiling was tested at P400,000 and P400,001', 'Pass'],
    ['FR-05', 'UC5', 'An applicant sees only his or her own stage; opening another record is refused', 'Pass'],
    ['FR-06', 'UC6', 'Elapsed working days are computed against the 3-, 7-, and 20-day tiers, excluding weekends and holidays entered by the administrator', 'Pass'],
    ['FR-07', 'UC7', 'Volume, stage conversion, and case aging are reported for any date range; totals reconcile with the raw case list; the report exports to CSV', 'Pass'],
    ['FR-08', 'UC8', 'Consent statement text, timestamp, and purpose are stored for every inquiry and application; no consent, no record', 'Pass'],
    ['FR-09', 'UC9', 'A reservation fee is validated only with an official receipt number, and a receipt number cannot be reused', 'Pass'],
    ['FR-10', 'UC10', 'The deficiency notice lists each document still pending after its deadline; repeat runs do not duplicate notices', 'Pass'],
    ['FR-11', 'UC11', 'An endorsed case reaches the financial aid coordinator queue with the document list of its program', 'Pass'],
    ['FR-12', 'UC12', 'Opening a record requires a stated purpose; the user, record, time, and purpose are logged, and applicants can download their own access log', 'Pass'],
    ['FR-13', 'UC13', 'Each ticket is owned by one named officer and cannot be resolved without a closing remark', 'Pass'],
    ['FR-14', 'UC14', 'An overdue ticket is raised to the School Administrator queue; on-time tickets are not', 'Pass'],
], [1.7, 1.9, 10.0, 1.9], inside=True)

heading('Prototype Screens')
para('Figures 1 to 6 were captured from the running prototype with an automated browser on October 28, 2026. '
     "The landing page uses the 1921 × 1080 Landing Page frame and its #FFF5C3 fill from the team's Figma file as its base.")
for num, (file, title, note) in enumerate([
    ('01-landing.png', 'Landing Page With the Looping Background Video', 'Desktop view seen by applicants and parents before signing in.'),
    ('05-applicant-dashboard.png', 'Applicant Dashboard', 'Shows the application stage, requirement status, subsidy matches, inquiries, and consent records (UC3, UC4, UC5, UC8).'),
    ('06-tickets.png', 'Admissions Officer Ticket Queue', 'Each ticket shows its owner and its elapsed working days against its service tier (UC6, UC13).'),
    ('13-applicant-record.png', 'Staff View of an Applicant Record', 'Covers requirement compliance, reservation fee validation, and subsidy endorsement (UC3, UC9, UC10, UC11).'),
    ('09-analytics.png', 'Admissions Analytics for the School Administrator', 'Inquiry volume, service-level compliance, stage conversion, and case aging for a selected date range (UC7).'),
    ('10-audit.png', 'Personal Data Access Log for the Data Protection Officer', 'Each entry records who opened which applicant record, when, and for what stated purpose (UC12).'),
], start=1):
    apa_figure(num, title, file, note)

heading('Background Video')
para(f'The landing page plays a {video["duration"]:.0f}-second seamless loop at {video["fps"]} frames per second, {video["width"]} × {video["height"]} pixels, '
     f'{video["size_mb"]:.1f} MB, encoded in H.264. It shows a slow fall down the core of an abandoned orbital station. '
     'Camera speed and the amber warning lamps pulse at 140 beats per minute. '
     f'The largest frame-to-frame brightness change is {video["max_delta"]:.2f} of 255 levels, far below the flash threshold of Success Criterion 2.3.1 (World Wide Web Consortium, 2023). '
     'The video is muted, carries no information, and has a Pause control. It does not play automatically for visitors who set their device to reduce motion.')

heading('Member Contributions')
para('Table 4 lists the role and contribution of each member. Each member signs his own row to confirm the contribution listed.')
apa_table(4, 'Member Roles and Contributions', ['Member', 'Role', 'Contribution', 'Signature'], [
    ['Atienza, Kurt Judd P.', 'Project Lead', 'Designed the landing frame in Figma; directed the AI-assisted build of the back end, database, and test suite; integrated and tested the prototype', ''],
    ['Garonia, Ian Humprey M.', 'UX/UI Designer and Tester', 'Designed screens in Figma; tested the prototype', ''],
    ['Apura, Alexis H.', 'UX/UI Designer and Tester', 'Designed screens in Figma; tested the prototype', ''],
    ['Tenedo, Francis Gerald G.', 'UX/UI Designer and Tester', 'Designed screens in Figma; tested the prototype', ''],
], [4, 3.4, 5.8, 2.8], inside=True, row_h=1.6)

doc.add_page_break()
heading('References')
for before, title, after in [
    ('Cloudflare. (2026, April 21). ', 'Data security', '. Cloudflare D1 Docs. https://developers.cloudflare.com/d1/reference/data-security/'),
    ('Department of Education. (n.d.). ', 'Senior high school voucher program guidelines', '. DepEd Region XI. https://depedroxi.ph/voucher-program/'),
    ('STI Education Services Group. (n.d.). ', 'Admissions', '. https://www.sti.edu/admissions.asp'),
    ('Unified Student Financial Assistance System for Tertiary Education. (n.d.). ', 'Tertiary education subsidy and Tulong Dunong program', '. https://unifast.gov.ph/tes.html'),
    ('World Wide Web Consortium. (2023). ', 'Web content accessibility guidelines (WCAG) 2.2', '. https://www.w3.org/TR/WCAG22/'),
]:
    para([before, (title, 'i'), after], align=LEFT, spacing=1.0, after=12, hanging=True)

doc.save(OUT)
print('ok')
