const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyInvoiceFunding } = require("../server/services/membershipPaymentVerification");
const env = { STRIPE_SECRET_KEY: "sk_test_fixture" };
const payment = { id: "ch_payment", amount: 700, amount_refunded: 0, paid: true, refunded: false, disputed: false, livemode: false };

test("historical paid invoice with a fully refunded charge is not counted as funded", async () => {
  const value = await verifyInvoiceFunding({id:"in_history",charge:{...payment,refunded:true,amount_refunded:700}},{env});
  assert.equal(value.verified,true); assert.equal(value.revoked,true);
  assert.deepEqual(value.references,["charge:ch_payment"]);
});
test("a partial refund preserves the remaining funded invoice", async () => {
  const value=await verifyInvoiceFunding({id:"in_history",charge:{...payment,amount_refunded:200}},{env});
  assert.equal(value.verified,true); assert.equal(value.revoked,false);
});
test("modern InvoicePayment references resolve through PaymentIntent to the actual charge", async () => {
  const paths=[];
  const fetchImpl=async(url)=>{
    paths.push(url);
    return {ok:true,json:async()=>url.includes("/invoice_payments")?
      {has_more:false,data:[{invoice:"in_history",status:"paid",livemode:false,payment:{type:"payment_intent",payment_intent:"pi_payment"}}]}:
      {id:"pi_payment",livemode:false,latest_charge:{...payment,payment_intent:"pi_payment"}}};
  };
  const value=await verifyInvoiceFunding({id:"in_history"},{env,fetchImpl});
  assert.equal(value.verified,true);assert.equal(value.revoked,false);
  assert.ok(paths[0].includes("invoice=in_history"));
  assert.deepEqual(new Set(value.references),new Set(["payment_intent:pi_payment","charge:ch_payment"]));
});
test("wrong-mode payment data and incomplete references are not silently accepted", async () => {
  assert.equal((await verifyInvoiceFunding({id:"in_history",charge:{...payment,livemode:true}},{env})).verified,false);
  const fetchImpl=async()=>({ok:true,json:async()=>({data:[],has_more:false})});
  assert.equal((await verifyInvoiceFunding({id:"in_history"},{env,fetchImpl})).verified,false);
});
test("unknown funding and external failures never become an unrefunded proof", async () => {
  const fetchImpl=async()=>({ok:false});
  await assert.rejects(verifyInvoiceFunding({id:"in_history",charge:"ch_payment"},{env,fetchImpl}));
});
