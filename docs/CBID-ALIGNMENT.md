# Aligning the LMS with CBID Institute

This release turns the generic "CBID University" build into the learning platform of **CBID Institute**, the
Centre of Excellence of **CBID Network PK Sindh**. It is based on a review of
[cbidnetwork.org](https://cbidnetwork.org) (home page and [CBID Institute](https://cbidnetwork.org/cbid-institute)),
carried out on 14 October 2026.

## What the website says

| Topic | From cbidnetwork.org | How the LMS uses it |
| --- | --- | --- |
| Organisation | Community Based Inclusive Development Network Pakistan (CBID Network PK Sindh), "Communities Creating Inclusive Futures"; founded in 2011 with WHO Pakistan; partners include DEPD Sindh, SAYYA and JICA | Footer and sign-in page: "An initiative of CBID Network PK Sindh" with the network's logo |
| CBID Institute | Flagship Centre of Excellence; tagline "Learn, Innovate & Implement"; first institute of its kind in the nonprofit sector | Product name, logo, sign-in headline, header |
| Programmes | Independent Living Training; Disability Equality Training (DET); Inclusive Business Training; Inclusive Education Training; Capacity Building Workshops; Customized Training | Four programme areas and seven seed courses built from these (see below) |
| Objectives | Training, workshops and **certification programmes** | New certificates feature with public verification |
| Audiences | Persons with disabilities and their families, communities, OPDs, government, corporates, academia, development partners | New "Who it is for" field on every course, shown and searchable in the catalogue |
| Values | Inclusion First, Nothing Without Us, Integrity, Excellence, Equality, Innovation | "Nothing about us without us" in course content; persons with disabilities written in full throughout |
| Contact | B-52/1, Block 13-D/1, Jamali Road, Gulshan-e-Iqbal, Karachi · info@cbidnetwork.org · +92 21 34155705 | Default settings: shown on the sign-in page, in the footer and in every email |
| Languages | English, Urdu and Sindhi (through Google Translate) | Not added; see "Still open" |
| Visual identity | Website: deep green `#122F2A`, green `#255B2D`, bronze `#9D7232`, cream `#F8F3E7`, DM Serif Text and Nunito. CBID Institute logo: navy `#0C3C60`, teal `#247890`, green `#6CA848`, orange `#FC9024` | LMS colours follow the **institute** logo (the platform belongs to the institute); headings use DM Serif Text like the website |

## Changes made

**Identity**
- Renamed everywhere: CBID University → CBID Institute (title, header, emails, settings, documentation, seed data).
- Real logos for CBID Institute and CBID Network PK Sindh (`frontend/src/assets/`), a new favicon in the institute's colours.
- New colour tokens from the institute logo, checked for WCAG 2.2 AA contrast in light and dark themes.
- Sign-in page rewritten around the institute's purpose; the form now comes first on phones and for screen readers.
- Footer with address, phone, email and website on every page.

**Language**
- Roles are shown as **Learner**, **Trainer** and **Administrator** (the institute trains professionals and
  community members; "student" and "teacher" read as school terms). Internal keys are unchanged.
- "Departments" are shown as **Programme areas**. "University-wide" became "institute-wide".
- Database error messages were updated by migration 0007 without editing earlier migrations.

**Content (development seed)**

| Code | Course | Programme area | Who it is for | Delivery |
| --- | --- | --- | --- | --- |
| DET101 | Disability Equality Training | Disability Equality and Rights | Staff of organisations, government officials, OPD members, persons with disabilities and families | Blended |
| IBT201 | Inclusive Business Training | Inclusive Business and Education | Employers, HR teams and line managers | Blended |
| IET201 | Inclusive Education Training | Inclusive Business and Education | Teachers, school leaders and education officers | Online |
| ILT101 | Independent Living Training | Independent Living and Empowerment | Persons with disabilities, families and peer supporters | Blended |
| CBW101 | Capacity Building Workshop for OPDs (draft) | Capacity Building and Customized Training | Organisations of persons with disabilities | Onsite |
| CT301 | Customized Training: Inclusive Public Services (draft) | Capacity Building and Customized Training | Government departments and public service providers | Onsite |
| DET090 | Disability Equality Awareness Session (archived) | Disability Equality and Rights | Community groups and volunteers | Onsite |

Course descriptions, modules and quizzes are **examples written for the demo**, not the institute's curriculum.
People in the seed data are fictional. Onsite sessions and assessments point to the Karachi address.

**New features**
- **Certificates:** trainers (for their courses) and administrators issue a certificate to an enrolled learner,
  see progress and grades beside each name, and can revoke with a reason. Learners get a notification and an email,
  and a printable certificate (one A4 landscape page, or PDF) with both logos, the serial number and the
  verification address.
- **Public verification** at `/verify`: anyone with a serial (for example an employer) can check that a certificate is
  genuine and still valid, without an account. It shows only the name, course, date and status.
- **Audience and delivery mode** on every course (administrator-controlled), with a delivery filter in the catalogue.
- **Institute settings:** name, parent organisation, support email, phone, address and website are editable by
  administrators and used on the sign-in page, in emails and on certificates.

## Decisions taken for you (easy to change)

You asked to be consulted on major design decisions; these were made so the platform could be delivered complete,
and each is simple to reverse:

1. **Name:** "CBID Institute" for the platform, with "CBID Network PK Sindh" as the parent organisation. Editable in
   Settings.
2. **Colours:** the institute logo's navy, teal, green and orange rather than the website's green and bronze, because
   the LMS is the institute's product. Changing the palette is a single file (`frontend/src/styles/tokens.css`).
3. **Body font:** Atkinson Hyperlegible Next instead of the website's Nunito, for readers with low vision.
4. **Terminology:** Learner and Trainer instead of Student and Teacher.
5. **Certificates are issued by a trainer's decision**, not automatically, until the institute sets completion rules.

## Still open (needs the institute)

- **Original logo files.** The bundled logos are the 225 px high versions on the website. Supply originals (SVG, or
  PNG at least 600 px high, transparent background) for print-quality certificates.
- **Certificate wording and signatory.** The certificate says "Certificate of completion" and names the issuing
  trainer. If certificates must carry a director's name, signature or accreditation text, provide it.
- **Programme details.** The website gives no durations, fees, schedules or entry requirements. Real course content
  should replace the demo modules.
- **Urdu and Sindhi.** A proper translation needs translated text from the institute and right-to-left layout
  work. The platform is English only for now.
- **Domain and email.** Decide the address (for example `learn.cbidnetwork.org`) before issuing real
  certificates, and authorise the SMTP provider for `cbidnetwork.org` (SPF and DKIM).
- **Organisation clients.** Customized Training for a company or department currently enrols each person
  individually; organisation accounts and reports would be a follow-up.
