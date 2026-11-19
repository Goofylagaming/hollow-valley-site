const desk = document.querySelector('[data-desk]');
const budget = Number(desk.dataset.budget);
const base = Number(desk.dataset.base);
const extra = Number(desk.dataset.extra);
const byId = id => document.getElementById(id);
const aud = n => '$' + n.toLocaleString('en-AU');
let added = false;
let published = null;
function render() {
  const amount = base + (added ? extra : 0);
  const variant = added ? 'saturday' : 'weekday';
  byId('cost').textContent = aud(amount);
  byId('balance').textContent = aud(budget - amount);
  byId('meter').value = amount;
  byId('change').textContent = added ? 'Remove Saturday shift' : 'Add Saturday shift';
  byId('change').setAttribute('aria-pressed', String(added));
  byId('saturday-row').hidden = !added;
  byId('hours').textContent = added ? '44 paid hours' : '40 paid hours';
  byId('workbook').href = './workbooks/' + variant + '.xlsx';
  byId('publish').disabled = published === added;
  byId('staff-link').hidden = published === null;
  if (published !== null) byId('staff-link').href = './staff/' + (published ? 'saturday' : 'weekday') + '/';
}
byId('change').addEventListener('click', () => {
  added = !added;
  render();
  byId('status').textContent = added ? 'Saturday added. ' + aud(budget - base - extra) + ' remaining.' : 'Saturday removed. ' + aud(budget - base) + ' remaining.';
  if (published !== null && published !== added) byId('status').textContent += ' Publish to update the team copy.';
});
byId('publish').addEventListener('click', () => {
  published = added;
  render();
  byId('status').textContent = 'Sample staff roster published. Open the staff copy to view or print.';
});
render();
