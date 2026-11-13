import Stripe from 'stripe';
import { transaction, nowISO } from './store.mjs';
export function stripeClient(env=process.env) {
  if(env.BI_STRIPE_ENABLED!=='true')throw new Error('Test billing is disabled');
  if(!/^(rk|sk)_test_/.test(env.BI_STRIPE_KEY||''))throw new Error('Only Stripe sandbox/test keys are accepted');
  return new Stripe(env.BI_STRIPE_KEY,{maxNetworkRetries:2,timeout:15000});
}
export function saveSubscription(db,s,price,time=Math.floor(Date.now()/1000)) {
  if(s.livemode!==false)throw new Error('Live subscription rejected');
  const c=db.prepare('SELECT id FROM customers WHERE stripe_customer=?').get(typeof s.customer==='string'?s.customer:s.customer.id);
  if(!c)return;
  const items=s.items?.data||[];
  const matching=items.filter(i=>i.price?.id===price);
  const ends=matching.map(i=>i.current_period_end).filter(Number.isFinite);
  let until=ends.length?Math.min(...ends):0;
  if(s.cancel_at)until=Math.min(until,s.cancel_at);
  if(s.ended_at)until=Math.min(until,s.ended_at);
  const status=matching.length&&!s.pause_collection?s.status:'unpaid';
  db.prepare(`INSERT INTO subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id,status=excluded.status,valid_until=excluded.valid_until,cancel_at_period_end=excluded.cancel_at_period_end,checked_at=excluded.checked_at`).run(s.id,c.id,status,until,Number(!!s.cancel_at_period_end),time);
}
const queues=new WeakMap();
export async function reconcileCustomer(db,c,stripe,price) {
  const task=(queues.get(db)||Promise.resolve()).then(()=>reconcile(db,c,stripe,price));
  queues.set(db,task.catch(()=>{}));return task;
}
async function reconcile(db,c,stripe,price) {
  if(!c.stripe_customer)return;
  const all=[];
  for await (const s of stripe.subscriptions.list({customer:c.stripe_customer,status:'all',limit:100}))all.push(s);
  transaction(db,()=>{
    db.prepare("UPDATE subscriptions SET status='canceled' WHERE customer_id=?").run(c.id);
    for(const s of all)saveSubscription(db,s,price);
  });
}
export async function checkout(db,c,stripe,env=process.env) {
  const price=await stripe.prices.retrieve(env.BI_STRIPE_PRICE_ID);
  if(price.livemode!==false||price.currency!=='aud'||price.unit_amount!==9900||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw new Error('Expected test AUD 99 monthly price');
  if(!c.stripe_customer){
    const customer=await stripe.customers.create({email:c.email,metadata:{hvs_bi_id:c.id}},{idempotencyKey:`hvs-bi-customer-${c.id}`});
    if(customer.livemode!==false)throw new Error('Live customer rejected');
    db.prepare('UPDATE customers SET stripe_customer=? WHERE id=?').run(customer.id,c.id);c={...c,stripe_customer:customer.id};
  }
  await reconcileCustomer(db,c,stripe,env.BI_STRIPE_PRICE_ID);
  if(db.prepare("SELECT 1 FROM subscriptions WHERE customer_id=? AND status IN ('active','trialing','past_due','incomplete','unpaid','paused')").get(c.id))throw new Error('Manage your existing subscription instead');
  const session=await stripe.checkout.sessions.create({mode:'subscription',customer:c.stripe_customer,line_items:[{price:price.id,quantity:1}],client_reference_id:c.id,subscription_data:{metadata:{hvs_bi_id:c.id}},success_url:env.BI_PUBLIC_URL+'/?checkout=returned',cancel_url:env.BI_PUBLIC_URL+'/',integration_identifier:'hvs_bi_pilot_qmztkplr'},{idempotencyKey:`hvs-bi-checkout-${c.id}-${Math.floor(Date.now()/1800000)}`});
  if(session.livemode!==false)throw new Error('Live checkout rejected');
  return session.url;
}
export async function handleWebhook(db,raw,signature,stripe,env=process.env) {
  if(!env.BI_STRIPE_WEBHOOK_SECRET)throw new Error('Webhook secret missing');
  const event=stripe.webhooks.constructEvent(raw,signature,env.BI_STRIPE_WEBHOOK_SECRET,300);
  if(event.livemode!==false)throw new Error('Live event rejected');
  if(db.prepare('SELECT 1 FROM webhook_events WHERE id=?').get(event.id))return {duplicate:true};
  const obj=event.data.object;
  let customer=typeof obj.customer==='string'?obj.customer:obj.customer?.id;
  const supported=event.type.startsWith('customer.subscription.')||['invoice.paid','invoice.payment_failed','checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type);
  if(supported&&customer){
    const c=db.prepare('SELECT * FROM customers WHERE stripe_customer=?').get(customer);
    // Re-read current Stripe state: delayed/out-of-order events cannot restore stale access.
    if(c)await reconcileCustomer(db,c,stripe,env.BI_STRIPE_PRICE_ID);
  }
  db.prepare('INSERT OR IGNORE INTO webhook_events VALUES(?,?)').run(event.id,nowISO());
  return {received:true};
}
