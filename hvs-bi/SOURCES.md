# Source register — verified 13 November 2026

Only openly licensed structured endpoints below are collected. Attributions are carried into normalized records, CSV and PDF; HVS transformations are identified. Council logos, copyrighted plans and applicant contact details are not copied.

## Logan undecided development applications

- Official council introduction: https://www.logan.qld.gov.au/planning-and-building/planning-and-development/development-enquiry-tool
- Licence metadata: https://www.arcgis.com/sharing/rest/content/items/50489a44f46b45b5857bcc7f9aa95f20?f=pjson
- API: https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer/0
- Metadata explicitly links https://creativecommons.org/licenses/by/3.0/au/ . Runtime collection checks that licence remains present.
- Stable key: Application_Number + Application_Amendment. Fields selected explicitly exclude Application_Applicant. PDonline_Link supplies per-record official links.
- Pages use OBJECTID ordering, 1,000 records, no geometry. Fetch all pages before replacing current presence. API total can include multiple parcels for one application.

## Brisbane development/infrastructure planning

- Dataset: https://data.brisbane.qld.gov.au/explore/dataset/cp14-lgip-pfti-parks-and-comm-facilities-future-park-upgrade-specific-location/
- API metadata: https://data.brisbane.qld.gov.au/api/explore/v2.1/catalog/datasets/cp14-lgip-pfti-parks-and-comm-facilities-future-park-upgrade-specific-location
- Licence: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ . Attribution from metadata: © The State of Queensland 2025 © Brisbane City Council 2025.
- Observed modified date: 14 July 2025. 103 records. Stable lgip_id and project_description verified against actual API responses.
- This is City Plan future park-upgrade planning data, not live development applications. Historical timing windows can have passed. Plans require current status confirmation.
- Development.i's official guidance/terms were inspected at https://www.brisbane.qld.gov.au/building-and-planning/supporting-documents-and-online-tools/development-near-me--development-i- . No verified bulk-commercial reuse grant or official DA export feed was established. Its undocumented endpoints and documents are not scraped. Adding a DA collector remains pending permitted access.

## Queensland forward procurement pipeline

- Catalogue: https://www.data.qld.gov.au/dataset/forward-procurement-pipeline
- CKAN metadata: https://www.data.qld.gov.au/api/3/action/package_show?id=forward-procurement-pipeline
- CSV resource ID: d3968658-dbb7-4732-bc19-467c49de23de. The connector discovers its URL from metadata instead of pinning a dated filename.
- Observed resource: Forward procurement pipeline - Sept 2026. Package licence_id CC-BY-4.0. https://creativecommons.org/licenses/by/4.0/
- CSV columns verified: Agency, Business Unit, Category Group, Category, Program Description, Estimated Timing for Release to Market, Procurement Method, Spend Range, Funding Status, Region SA4, Agency Region, Link, Cat Leads Agency, Contact Email, Brisbane 2032 related. Contact Email is not retained.
- Resource redirects are followed only to the explicit approved HTTPS hosts, at most three times. The current CSV redirects within www.data.qld.gov.au.
- A programme with procurement method Open tender is still a future pipeline entry. No tender deadline or “open for bids” state is fabricated. Archived/past release windows must be checked with the agency. No QTenders scraping is implemented.

## Integration documentation checked

- Stripe webhook verification, retries and event ordering: https://docs.stripe.com/webhooks
- Subscription lifecycle: https://docs.stripe.com/billing/subscriptions/webhooks
- Tax setup for future launch: https://docs.stripe.com/billing/taxes/collect-taxes

Licence verification here records publisher metadata, not a blanket legal opinion about every downstream use. If a source licence changes, the collector stops for review rather than silently continuing.
