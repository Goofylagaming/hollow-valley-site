# HVS BI business workflow and portfolio

HVS BI sells saved research time: a traceable, filtered watchlist of public construction signals for South East Queensland trades. It does not sell guaranteed jobs, proprietary tender access or applicant contact lists.

## Customer and operating workflow

1. Invite a small group of trades businesses to a private pilot. Explain exactly which councils/data types are covered and show the sample report.
2. Customer selects trade categories and locations. For this MVP the operator provisions a private access key; customers save their own preferences and email consent.
3. Offer **A$99/month hypothetically** for dashboard access plus weekly PDF/CSV. Current billing is test-only. Confirm pricing demand, GST treatment and support terms before a live launch.
4. Retrieve licensed official data, validate its licence/schema, normalize records and preserve sources. Update changed records and suppress duplicates and disappeared entries.
5. Match customer filters using transparent keyword rules. Mark uncertainty and distinguish planning applications, infrastructure plans and procurement pipelines. Human review is still needed for source changes, ambiguous matches and customer feedback.
6. Target weekly delivery **Monday 7am Brisbane time**. The implemented worker starts processing at that time, so inbox delivery follows. Source failures withhold the run for review. The first report is a baseline; later reports emphasize new/changed records.
7. Customer opens the dashboard or attachments, checks official source documents and chooses which projects to investigate. Procurement eligibility and bid submission remain the customer's responsibility.
8. Test subscription webhooks manage access and cancellation. A period-end cancellation preserves access to the paid-through date; immediate cancellation/failed states revoke it. Email and real payment launch remain disabled.
9. Operator reviews source health, uncertain deliveries, relevance feedback and retention. Fix poor coverage before acquiring more customers.

## Hypothetical unit economics

At A$99/month: 10 subscribers = A$990 gross monthly revenue; 25 = A$2,475; 50 = A$4,950. These are arithmetic scenarios, not forecasts or profit. Subtract hosting, email, payment fees, any GST obligations, support/review time and customer acquisition. No paid AI generation is required for this MVP. Validate willingness to pay before expanding council coverage or building a large platform.

## Other initiatives, compared using the user's stated concepts

| Initiative | Offer / revenue model | What it needs | Relative fit |
|---|---|---|---|
| Local business websites | A$500 setup + A$50/month, as proposed | Sales, content collection, fixed scope, hosting and support boundaries | Concrete service with an upfront fee; recurring maintenance is lower per customer. Useful audience overlap with BI. |
| HVS BI | Hypothetical A$99/month for dashboard + weekly reports | Licensed coverage, reliable collection, relevant matches, renewals | Narrow repeatable product; value depends on customer usefulness, not raw record volume. |
| AI assistant dashboards for trades/councils/musicians | Workflow tools; price not specified | Customer-specific integrations, permissions, accuracy and support | Can command tailored service fees, but each niche adds complexity. BI may become one module after validation. |
| Primalbound / Hollow Valley games and premium membership | Entertainment, community and premium benefits | Gameplay/content updates, operations, community retention | Existing HVS ecosystem; different audience and operating demands. Keep BI subscriptions separate. |
| Fourthwall merchandise and coloring books | Per-item physical/digital product sales | Original designs, catalogue quality, traffic and margin management | Brand extension; demand and fulfilment/product costs determine returns. No store changes made here. |
| AI/developer tools and other digital products | One-off licences, downloads or subscriptions; price unspecified | A distinct useful tool, documentation, support and distribution | Reusable products can scale, but need a defined buyer/problem and validation. No new tool platform built here. |

These are business-model comparisons, not claims that every initiative is launched or profitable. A sensible next milestone is a small customer trial measuring useful signals, time saved, report opens and renewal intent. Keep bespoke websites as a separate scoped service; expand BI only when its current coverage earns repeat use.

## Implementation milestones

- **Completed in code:** isolated app, three permitted feeds, normalized storage, private dashboard, saved filters, reports, safe weekly/email pipeline, test-only billing and tests.
- **Next staging acceptance:** configure dedicated sandbox keys; perform real test Checkout, webhook and portal cancellation flows; verify a consented allowlisted test email; restore-test the staging database.
- **Coverage milestone:** establish permitted Brisbane DA and current tender feeds; strengthen region mapping and match quality using pilot feedback.
- **Launch decision:** user approval for production hosting/routing and any payment collection, plus pricing/GST terms, production authentication, risk-event handling, monitoring, backups and support readiness.
