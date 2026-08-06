# Departments & Members

Generated from `DEPARTMENTS`, `STAFF_DIRECTORY` and `STAFF_EXTRA_DEPARTMENTS` in
[components/settings/staff.ts](components/settings/staff.ts), which is also what
`scripts/apply-department-roster.mts` applies to the live accounts.
Emails are derived by `staffEmail()` — first initial + surname `@credicorp.ng`.

**36 staff across 13 departments**, as confirmed by the Head of Audit on 2026-08-06.

Since 2026-08-05 a department is an **access control**, not a label: an Action Owner sees every
internal observation raised against their department and any of them can respond to it and mark it
Ready for Closure. The "Observations" figure below is what each department's members currently see.
See [lib/dept-scope.ts](lib/dept-scope.ts) for how a record's department is resolved.

---

## Administration Department — 4 · 0 observations

| Name | Job title | Email |
| --- | --- | --- |
| Wuraola Odubiyi | Head, Admin, People & Culture | wodubiyi@credicorp.ng |
| Toyin Olaiya | Professional - Admin | tolaiya@credicorp.ng |
| Delight Nwafor | Professional - Customer Support | dnwafor@credicorp.ng |
| Peace Oyewumi | Management Trainee | poyewumi@credicorp.ng |

Wuraola Odubiyi also belongs to **People & Culture Department**.

## Credit Operations — 4 · 21 observations

| Name | Job title | Email |
| --- | --- | --- |
| Sadiq Mohammed | Head, Credit Operations | smohammed@credicorp.ng |
| Sussan Omiete | Professional - Credit Operations | somiete@credicorp.ng |
| Fatima Mustafa Bello | Professional - Credit Operations | fbello@credicorp.ng |
| Saadatu Alkali | EA to the ED Credit and Portfolio Mgmt. | salkali@credicorp.ng |

## Finance — 4 · 28 observations

| Name | Job title | Email |
| --- | --- | --- |
| Jonathan Aderibigbe | Chief Financial Officer | jaderibigbe@credicorp.ng |
| Tubolayefa George | Specialist - Finance | tgeorge@credicorp.ng |
| Najma Goni | Management Trainee | ngoni@credicorp.ng |
| Tochukwu Chukwuani | Management Trainee | tchukwuani@credicorp.ng |

## Impact & Sustainability — 2 · 1 observation

| Name | Job title | Email |
| --- | --- | --- |
| Emmanuel Nwaka | Lead, Impact & Sustainability | enwaka@credicorp.ng |
| Elizabeth Adu | E.A to the E.D Operations | eadu@credicorp.ng |

## Internal Audit — 2 · all observations

| Name | Job title | Email |
| --- | --- | --- |
| Awa Michael | Head, Internal Audit | amichael@credicorp.ng |
| Halima Ahmed | Intern | hahmed@credicorp.ng |

Internal Audit is scoped by role, not by department — both accounts see the whole register.

## IT — 2 · 0 observations

| Name | Job title | Email |
| --- | --- | --- |
| Solomon Aladegolu | Professional - IT | saladegolu@credicorp.ng |
| Chiamaka Ogoh | Management Trainee | cogoh@credicorp.ng |

## Legal — 2 · 2 observations

| Name | Job title | Email |
| --- | --- | --- |
| Obiageli Vera Ohakim | Head, Legal & Company Secretary | oohakim@credicorp.ng |
| Beulah Lekwauwa | Professional - Corporate Counsel | blekwauwa@credicorp.ng |

## Office of the Managing Director — 5 · 0 observations

| Name | Job title | Email |
| --- | --- | --- |
| Ladi Amusu | Chief of Staff | lamusu@credicorp.ng |
| Elizabeth Faboyo | Technical Adviser to the MD/CEO & Lead, Fundraising | efaboyo@credicorp.ng |
| Peter Esemuede | Technical Adviser to the MD/CEO & Lead, External Relations | pesemuede@credicorp.ng |
| Dorcas Okolo | Management Trainee | dokolo@credicorp.ng |
| Adanu Ayegba | Professional - Protocol | aayegba@credicorp.ng |

Ladi Amusu also belongs to **Corporate Communications**, and holds the 7 external findings raised
against the MD's office.

## People & Culture Department — 2 · 8 observations

| Name | Job title | Email |
| --- | --- | --- |
| Olusola Adetiba | Professional - People & Culture | oadetiba@credicorp.ng |
| Ziga Paago | Management Trainee | zpaago@credicorp.ng |

Plus Wuraola Odubiyi, whose home department is the Administration Department.

## Procurement — 3 · 5 observations

| Name | Job title | Email |
| --- | --- | --- |
| Imoh Usoro | Head, Procurement | iusoro@credicorp.ng |
| Opeyemi Ayediran | Professional - Procurement | oayediran@credicorp.ng |
| Yachat Kanwai | Management Trainee | ykanwai@credicorp.ng |

## Risk Management — 3 · 17 observations

| Name | Job title | Email |
| --- | --- | --- |
| Asari Etuk | Head, Risk and Compliance | aetuk@credicorp.ng |
| Terry Akpata | Professional - Risk & Compliance | takpata@credicorp.ng |
| Emmanuel Okechukwu | Professional - IT Risk & Compliance | eokechukwu@credicorp.ng |

## Corporate Communications — 1 · 6 observations

| Name | Job title | Email |
| --- | --- | --- |
| Michael Ojo | Professional - Strategic Communications | mojo@credicorp.ng |

Plus Ladi Amusu, whose home department is the Office of the Managing Director.

## Strategy — 2 · 19 observations

| Name | Job title | Email |
| --- | --- | --- |
| Alexander Ehanire | Head, Strategy & Innovation | aehanire@credicorp.ng |
| Anthony Aneke | Professional - Innovation | aaneke@credicorp.ng |

---

## Not in AuditLens

| Name | Role | Why |
| --- | --- | --- |
| Uzoma Nwagba | Managing Director | Receives the Board assurance brief as a tokenised link — no account by design |
| Aisha Abdullahi | Executive Director – Credit & Portfolio Management | As above |
| Olanike Kolawole | Executive Director – Operations | As above |

Four accounts were removed on 2026-08-06 (Eniola Anishe, Diekololaoluwa Adewale, Boluwatife
Inaolaji, Oluwatoyosi Ibinaiye).

## Departments with no workspace record

**Administration Department** and **IT** have no entry under Settings → Departments & action owners, so
nothing resolves to them: their members see an empty portal until Internal Audit raises an
observation against a department of that name.

## Renamed departments

`normalizeDept()` in [lib/dept-scope.ts](lib/dept-scope.ts) aliases the previous names onto the
current ones, so observations raised under the old spelling remain reachable:

| Was | Now |
| --- | --- |
| Audit Department | Internal Audit |
| Strategic Comms · Strategic Communications | Corporate Communications |
| Finance Department · Finance & Accounts | Finance |
| Legal Department | Legal |
| Operations Department | Impact & Sustainability |
| Procurement Department | Procurement |
| Strategy Department | Strategy |
