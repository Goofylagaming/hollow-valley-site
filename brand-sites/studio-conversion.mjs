// Public Hollow Valley Studios website offer.
// Checkout on the site is the one-off AUD $500 Website Setup Payment Link only.
// The monthly managed-service payment link is sent privately on launch day.

export const websiteSetupCheckout = 'https://buy.stripe.com/dRm6oIffs4n1fdBc831oI00';

export const websitesDescription = 'Managed websites for Queensland tradies and local businesses: AUD $500 setup + AUD $50/month for hosting, SSL, backups, updates and quote forms. Built and managed by Hollow Valley Studios, no meeting required.';

const business = {
  '@type': ['ProfessionalService', 'LocalBusiness', 'Organization'],
  '@id': 'https://hollowvalleystudios.com/#business',
  name: 'Hollow Valley Studios',
  url: 'https://hollowvalleystudios.com/',
  email: 'contact@hollowvalleystudios.com',
  description: 'Independent Queensland studio building games, websites and digital tools, including managed websites for small and local businesses.',
  areaServed: [
    { '@type': 'Place', name: 'Logan, Queensland' },
    { '@type': 'Place', name: 'Park Ridge, Queensland' },
    { '@type': 'State', name: 'Queensland' }
  ],
  sameAs: [
    'https://www.facebook.com/hollowvalleystudios',
    'https://www.instagram.com/hollowvalleystudios/'
  ],
  makesOffer: { '@id': 'https://hollowvalleystudios.com/websites/#offer' }
};

const offerGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    business,
    {
      '@type': 'Service',
      '@id': 'https://hollowvalleystudios.com/websites/#service',
      name: 'Managed websites for local businesses',
      serviceType: 'Website design, hosting and management',
      provider: { '@id': 'https://hollowvalleystudios.com/#business' },
      areaServed: { '@type': 'State', name: 'Queensland' },
      url: 'https://hollowvalleystudios.com/websites/',
      offers: {
        '@type': 'Offer',
        '@id': 'https://hollowvalleystudios.com/websites/#offer',
        url: 'https://hollowvalleystudios.com/websites/',
        priceCurrency: 'AUD',
        price: '500.00',
        description: 'AUD $500 initial setup, then AUD $50/month managed service (hosting, SSL, DNS/domain support, maintenance, backups, basic content updates, quote/contact form management, analytics, technical support). Domain registration billed separately at cost.',
        priceSpecification: [
          { '@type': 'UnitPriceSpecification', name: 'Initial setup', price: '500.00', priceCurrency: 'AUD' },
          { '@type': 'UnitPriceSpecification', name: 'Managed service', price: '50.00', priceCurrency: 'AUD', billingDuration: 'P1M', unitText: 'MONTH' }
        ]
      }
    }
  ]
};

const homeBusiness = {
  '@context': 'https://schema.org',
  '@graph': [business]
};

const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

export const studioHomeHead = `<link rel="canonical" href="https://hollowvalleystudios.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Hollow Valley Studios">
<meta property="og:locale" content="en_AU">
<meta property="og:url" content="https://hollowvalleystudios.com/">
<meta property="og:title" content="Hollow Valley Studios — Games, websites & digital tools">
<meta property="og:description" content="Managed websites for local businesses: AUD $500 setup + AUD $50/month. Queensland-built games and digital tools.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Hollow Valley Studios — Games, websites & digital tools">
<meta name="twitter:description" content="Managed websites for local businesses: AUD $500 setup + AUD $50/month. Queensland-built games and digital tools.">
${jsonLd(homeBusiness)}`;

export const websitesHead = `<link rel="canonical" href="https://hollowvalleystudios.com/websites/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Hollow Valley Studios">
<meta property="og:locale" content="en_AU">
<meta property="og:url" content="https://hollowvalleystudios.com/websites/">
<meta property="og:title" content="Managed Business Websites in Queensland | Hollow Valley Studios">
<meta property="og:description" content="A professional website for your services, photos and quote enquiries. AUD $500 setup + AUD $50/month, built and managed by HVS. Everything by email or text.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Managed Business Websites in Queensland | Hollow Valley Studios">
<meta name="twitter:description" content="AUD $500 setup + AUD $50/month managed websites for tradies and local businesses. No meeting required.">
${jsonLd(offerGraph)}
<style>
  .hvs-enquire{background:#dce3d3;padding:36px;border:1px solid var(--line,#bfc8bd)}
  .hvs-enquire h2{margin:0 0 6px}
  .hvs-enquire p.hvs-lede{margin:0 0 22px;color:var(--muted,#505f58)}
  .hvs-form{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px}
  .hvs-form .full{grid-column:1/-1}
  .hvs-form label{display:block;font-size:13px;font-weight:650;letter-spacing:.02em;margin-bottom:5px;color:var(--ink,#202e29)}
  .hvs-form input,.hvs-form select,.hvs-form textarea{width:100%;box-sizing:border-box;font:16px/1.4 system-ui,sans-serif;padding:11px 12px;border:1px solid #9fae9f;background:#f7f5ee;color:var(--ink,#202e29);border-radius:0}
  .hvs-form input:focus,.hvs-form select:focus,.hvs-form textarea:focus{outline:2px solid #294936;outline-offset:1px}
  .hvs-form textarea{min-height:96px;resize:vertical}
  .hvs-hp{position:absolute!important;left:-9999px!important;height:0;overflow:hidden}
  .hvs-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
  .hvs-actions .button{cursor:pointer;border:1px solid #294936;font-family:inherit}
  .hvs-actions .button.secondary{background:transparent;color:#294936}
  .hvs-note{font-size:13px;color:var(--muted,#505f58);margin:14px 0 0}
  .hvs-status{margin-top:14px;font-weight:650}
  .hvs-pay{margin-top:26px;padding-top:20px;border-top:1px solid var(--line,#bfc8bd)}
  .hvs-pay p{margin:0 0 10px}
  .hvs-ctabar{position:fixed;left:0;right:0;bottom:0;z-index:50;display:none;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#202e29;box-shadow:0 -4px 18px rgba(0,0,0,.18)}
  .hvs-ctabar a{flex:1;text-align:center;padding:12px 8px;font-weight:650;font-size:14px;text-decoration:none;background:#d4e78d;color:#172116}
  .hvs-ctabar a.alt{background:transparent;color:#f3efdf;border:1px solid #6b7d70}
  @media(max-width:650px){
    .hvs-form{grid-template-columns:1fr}
    .hvs-enquire{padding:24px}
    .hvs-ctabar.on{display:flex}
    body.studio{padding-bottom:72px}
  }
  [hidden]{display:none!important}
</style>`;

export const websiteEnquiry = `<div id="hvs-cta-config" data-phone="" data-endpoint="" data-stripe-link="${websiteSetupCheckout}" hidden></div>
<div class="hvs-enquire" id="hvs-enquire">
  <div class="eyebrow">Free demo · No meeting required</div>
  <h2>Get a website demo for your business</h2>
  <p class="hvs-lede">Tell us the basics and we'll build a demo you can look at in your own time. Reply by email or text, whichever suits.</p>
  <form class="hvs-form" id="hvs-form" novalidate>
    <div><label for="hvs-name">Your name</label><input id="hvs-name" name="name" autocomplete="name" required></div>
    <div><label for="hvs-business">Business name</label><input id="hvs-business" name="business" autocomplete="organization" required></div>
    <div><label for="hvs-trade">Trade / services</label><input id="hvs-trade" name="trade" placeholder="e.g. concreting, driveways, slabs"></div>
    <div><label for="hvs-area">Service area</label><input id="hvs-area" name="area" placeholder="e.g. Logan, Ipswich, Gold Coast"></div>
    <div><label for="hvs-phone">Mobile</label><input id="hvs-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel"></div>
    <div><label for="hvs-email">Email</label><input id="hvs-email" name="email" type="email" autocomplete="email"></div>
    <div><label for="hvs-site">Current website or Facebook page (if any)</label><input id="hvs-site" name="current_site" type="url" placeholder="https://"></div>
    <div><label for="hvs-pref">Best way to reply</label>
      <select id="hvs-pref" name="preferred_contact"><option>Text</option><option>Email</option><option>Phone call</option></select></div>
    <div class="full"><label for="hvs-notes">Anything else? (optional)</label><textarea id="hvs-notes" name="notes" placeholder="Services you want listed, photos you have, deadlines…"></textarea></div>
    <div class="hvs-hp" aria-hidden="true"><label for="hvs-website">Leave blank</label><input id="hvs-website" name="website" tabindex="-1" autocomplete="off"></div>
    <div class="full hvs-actions">
      <button type="submit" class="button">Send my demo request →</button>
      <a class="button secondary" id="hvs-sms" hidden>Text us instead</a>
      <a class="button secondary" id="hvs-call" hidden>Call</a>
    </div>
  </form>
  <div class="hvs-status" id="hvs-status" role="status" aria-live="polite"></div>
  <p class="hvs-note">AUD $500 initial setup + AUD $50/month managed service. You only pay once you've approved the design.
    Prefer email? <a href="mailto:contact@hollowvalleystudios.com">contact@hollowvalleystudios.com</a></p>
  <div class="hvs-pay" id="hvs-pay">
    <p><strong>Approved your demo?</strong> Pay the $500 setup by card to lock in your build.</p>
    <a class="button" id="hvs-pay-link" href="${websiteSetupCheckout}" target="_blank" rel="noopener noreferrer">Pay $500 setup securely →</a>
    <p class="hvs-note">Secure card checkout by Stripe. Your $50/month managed service only starts once your site goes live.</p>
  </div>
</div>`;

export const websitesAfter = `<nav class="hvs-ctabar" id="hvs-ctabar" aria-label="Quick contact">
  <a class="alt" id="hvs-bar-call" hidden>Call</a>
  <a class="alt" id="hvs-bar-sms" hidden>Text</a>
  <a href="#hvs-enquire">Get a free demo</a>
</nav>
<script>
(function () {
  var cfg = document.getElementById('hvs-cta-config');
  if (!cfg) return;
  var phone = (cfg.dataset.phone || '').trim();
  var endpoint = (cfg.dataset.endpoint || '').trim();
  var pay = (cfg.dataset.stripeLink || '').trim();
  var smsBody = encodeURIComponent('Hi HVS, I\\'d like a website demo for my business: ');

  function show(id, href) { var el = document.getElementById(id); if (el) { el.href = href; el.hidden = false; } }
  if (phone) {
    show('hvs-call', 'tel:' + phone); show('hvs-bar-call', 'tel:' + phone);
    show('hvs-sms', 'sms:' + phone + '?&body=' + smsBody); show('hvs-bar-sms', 'sms:' + phone + '?&body=' + smsBody);
  }
  if (/^https:\\/\\/(buy\\.stripe\\.com|checkout\\.stripe\\.com)\\//.test(pay)) {
    var p = document.getElementById('hvs-pay-link'); p.href = pay; document.getElementById('hvs-pay').hidden = false;
  }
  var bar = document.getElementById('hvs-ctabar'); if (bar) bar.classList.add('on');

  var form = document.getElementById('hvs-form');
  var status = document.getElementById('hvs-status');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var d = new FormData(form);
    if (d.get('website')) return;
    if (!d.get('name') || !d.get('business')) { status.textContent = 'Please add your name and business name.'; return; }
    if (!d.get('phone') && !d.get('email')) { status.textContent = 'Please add a mobile or email so we can reply.'; return; }
    d.delete('website');
    d.append('page', location.href);

    function mailFallback() {
      var lines = [];
      d.forEach(function (v, k) { if (v) lines.push(k.replace('_', ' ') + ': ' + v); });
      location.href = 'mailto:contact@hollowvalleystudios.com?subject=' +
        encodeURIComponent('Managed website demo: ' + d.get('business')) + '&body=' + encodeURIComponent(lines.join('\\n'));
      status.textContent = 'Opening your email app with your details filled in…';
    }
    if (!endpoint) { mailFallback(); return; }
    status.textContent = 'Sending…';
    fetch(endpoint, { method: 'POST', body: d, headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); form.reset();
        status.textContent = 'Thanks! We\\'ll be in touch by your preferred method, usually within one business day.'; })
      .catch(function () { mailFallback(); });
  });
})();
</script>`;

export const hollowValleySitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://hollowvalleystudios.com/</loc>
    <lastmod>2026-11-20</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/websites/</loc>
    <lastmod>2026-11-20</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/tradie/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/daymark/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/council/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/gigmatch/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/gigmatch/about/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/gigmatch/musician/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/gigmatch/venue/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>
  <url>
    <loc>https://hollowvalleystudios.com/merch/</loc>
    <lastmod>2026-11-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
`;

export const hollowValleyRobots = `User-agent: *
Allow: /

Sitemap: https://hollowvalleystudios.com/sitemap.xml
`;
