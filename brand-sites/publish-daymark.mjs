import { cp, mkdir, writeFile } from 'node:fs/promises';
import { store, people, shifts, budget, baseCost, saturdayCost } from './daymark/scenario.mjs';
const out = new URL('./dist/hollow-valley/daymark/', import.meta.url);
const source = new URL('./daymark/', import.meta.url);
const production = process.argv.includes('--production');
const money = n => '$' + n.toLocaleString('en-AU');
const weekLabel = '16–22 November 2026';
const enquiry = 'mailto:contact@hollowvalleystudios.com?subject=Daymark%20retail%20pilot';
function shell(title, body, staff = false) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="${production && !staff ? 'index,follow' : 'noindex,nofollow'}"><title>${title} | Hollow Valley Studios</title><link rel="stylesheet" href="/daymark/site.css"></head><body class="${staff ? 'staff' : 'manager'}"><a class="skip" href="#main">Skip to roster</a><header><div class="top"><strong>Daymark eTimesheets</strong><a href="/#demos">Hollow Valley Studios</a></div></header>${body}</body></html>`;
}
function table(rows, manager) {
  return `<table aria-label="Weekly shifts"><thead><tr><th scope="col">Day</th><th scope="col">Employee</th><th scope="col" class="role">Role</th><th scope="col">Shift</th></tr></thead><tbody>${rows.map(s => {
    const person = people[s.who];
    const legend = s.break ? `<small class="mobile-role">${s.break} min unpaid break</small>` : '';
    return `<tr${manager && s === shifts.at(-1) ? ' id="saturday-row" hidden' : ''}><td>${s.day}</td><td>${person.name}<span class="mobile-role">${person.job}</span></td><td class="role">${person.job}</td><td><span class="num">${s.start}–${s.end}</span>${legend}</td></tr>`;
  }).join('')}</tbody></table>`;
}
const manager = shell('Daymark retail roster demo', `<main id="main" data-desk data-budget="${budget}" data-base="${baseCost}" data-extra="${saturdayCost}"><span class="demo-label">Retail roster demo · ${store}</span><h1>Can we cover Saturday?</h1><p class="lead">Try a four-hour shift at this fictional shop, check the wage budget, then publish the team’s roster.</p>
<div class="metrics" aria-label="Weekly wage estimate in Australian dollars"><div><span class="caption">Wage budget</span><strong class="number">${money(budget)}</strong></div><div><span class="caption">Roster cost</span><strong id="cost" class="number">${money(baseCost)}</strong></div><div class="remaining"><span class="caption">Remaining</span><strong id="balance" class="number">${money(budget - baseCost)}</strong></div><progress id="meter" aria-label="Forecast cost against weekly budget" value="${baseCost}" max="${budget}"></progress></div>
<section class="panel add"><div><h2>Saturday stockroom cover</h2><p>Remy Moss · 10:00–14:00</p><div class="cost-line">4 hours × $32 = $128 · sample rate</div></div><button id="change" type="button" aria-pressed="false">Add Saturday shift</button></section>
<section class="panel"><div class="sectionhead"><div><h2>Weekly roster</h2><p>${weekLabel}</p></div><strong id="hours">40 paid hours</strong></div>${table(shifts,true)}<small>Weekday shifts include a 30-minute unpaid break.</small><div class="actions"><button id="publish" type="button">Publish staff roster</button><a class="button secondary" id="workbook" href="./workbooks/weekday.xlsx" download>Download manager Excel</a><a class="button secondary" id="staff-link" href="./staff/weekday/" hidden target="_blank" rel="noopener">Open staff copy</a></div><p class="status" id="status" role="status" aria-live="polite"></p></section>
<div class="foot"><a href="${enquiry}">Ask about a Daymark pilot</a><small>Demo changes last for this visit. All people, budgets and pay rates are fictional.</small></div><noscript><p>Enable JavaScript to try the shift change and staff publishing.</p></noscript></main><script src="./demo.js" defer></script>`);
await mkdir(out, { recursive: true });
await writeFile(new URL('index.html',out), manager);
for (const name of ['site.css','demo.js','workbooks']) await cp(new URL(name,source), new URL(name,out), { recursive:true });
for (const variant of ['weekday','saturday']) {
  const folder = new URL('staff/' + variant + '/',out);
  const roster = variant === 'saturday' ? shifts : shifts.slice(0,-1);
  const page = shell('Sample staff roster', `<main id="main"><span class="demo-label">Sample staff copy · ${store}</span><h1>Team roster</h1><p class="lead">Week of ${weekLabel}</p><div class="panel">${table(roster,false)}<small>Weekday shifts include a 30-minute unpaid break.</small></div><button class="no-print" type="button" onclick="window.print()">Print staff copy</button></main>`, true);
  await mkdir(folder, { recursive:true });
  await writeFile(new URL('index.html',folder), page);
}
