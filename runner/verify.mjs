// This verifier is outside the snapshot and cannot be edited by the repair model.
import { summarizeOrder } from '/app/summary.mjs';
const invoke=input=>{try{return summarizeOrder(input);}catch(e){return {status:500,body:{error:'INTERNAL_ERROR'},exception:String(e.stack)}}};
const cases=[
  ['بدون فیلد اختیاری تخفیف',{items:[{price:100,quantity:2}]},{status:200,body:{subtotal:200,discount:0,total:200}}],
  ['تخفیف خالی',{items:[{price:100,quantity:2}],discounts:[]},{status:200,body:{subtotal:200,discount:0,total:200}}],
  ['تخفیف معتبر',{items:[{price:100,quantity:2}],discounts:[10,20]},{status:200,body:{subtotal:200,discount:30,total:170}}],
  ['ورودی تخفیف نامعتبر',{items:[{price:100,quantity:1}],discounts:'10'},{status:400,body:{error:'INVALID_DISCOUNTS'}}],
  ['آیتم نامعتبر',{items:[],discounts:[]},{status:400,body:{error:'INVALID_ITEMS'}}],
  ['حالت نگه‌داشته‌شده: دو آیتم',{items:[{price:35,quantity:3},{price:41,quantity:2}]},{status:200,body:{subtotal:187,discount:0,total:187}}],
  ['حالت نگه‌داشته‌شده: تخفیف منفی',{items:[{price:40,quantity:1}],discounts:[-2]},{status:400,body:{error:'INVALID_DISCOUNTS'}}],
];
const checks=cases.map(([name,input,expected])=>{const actual=invoke(input);return {name,passed:JSON.stringify(actual)===JSON.stringify(expected),expected,actual}});
console.log(JSON.stringify({passed:checks.every(c=>c.passed),checks}));
