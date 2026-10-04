import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installGym} from './gym.mjs';

test('LAN gym: persistence, access boundaries, member isolation, ledgers and media',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gym-test-'));
 const start=async()=>{const app=express();app.use(express.json());installGym(app,{root,isServer:req=>req.headers['x-test-admin']==='1'});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));return server;};
 let server=await start();let base=`http://127.0.0.1:${server.address().port}/api/gym/`;
 const req=async(url,body,admin=true,cookie='')=>{const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(admin?{'x-test-admin':'1'}:{}),...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};};
 const create=async(type,b)=>{const r=await req('records/'+type,b);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.id;};
 try{
  const a=await create('members',{name:'عضو آزمایشی',phone:'09120000001',gender:'male',pin:'test-pass'});
  const b=await create('members',{name:'عضو دوم',phone:'09120000002',gender:'female',pin:'test-pass'});
  const codes=(await req('state')).data.members.map(x=>x.code);assert.equal(new Set(codes).size,2);assert.ok(codes.every(x=>/^\d{3,}$/.test(x)));
  assert.equal((await req('records/members',{name:'عضو آزمایشی',phone:'09120000003',gender:'male',pin:'test-pass'})).status,400);
  assert.equal((await req('records/members',{name:'عضو سوم',phone:'09120000001',gender:'male',pin:'test-pass'})).status,400);
  assert.equal((await req('records/members',{name:'نفوذ',code:'300'},false)).status,403);
  assert.equal((await req('attendance',{memberId:a})).status,400);
  const plan=await create('plans',{title:'روزانه',days:1,fee:100});
  const today=(await req('state')).data.today;
  await create('subscriptions',{memberId:a,planId:plan,start:today});
  await create('payments',{memberId:a,amount:80,date:today});
  await create('payments',{memberId:b,amount:20,date:today});
  assert.equal((await req('attendance',{memberId:a})).status,200);
  assert.equal((await req('attendance',{memberId:a})).status,200);
  const prod=await create('products',{title:'آب',unit:'عدد',minimum:2});
  await create('movements',{productId:prod,quantity:3,direction:'in',note:'خرید'});
  assert.equal((await req('records/movements',{productId:prod,quantity:4,direction:'out',note:'فروش'})).status,400);
  assert.equal((await req('records/payments',{memberId:a,amount:-5,date:today})).status,400);
  const imagePath=path.join(root,'test.png');fs.writeFileSync(imagePath,'media-test');
  const ex=await create('exercises',{title:'حرکت',group:'پشت',imagePath,status:'draft'});
  let pub=(await req('state',undefined,false)).data;assert.equal(pub.exercises.length,0);assert.equal(pub.members,undefined);
  let r=await fetch(base+`media/${ex}/image`);assert.equal(r.status,404);
  await create('exercises',{id:ex,title:'حرکت جدید',group:'پشت',imagePath,status:'published'});
  pub=(await req('state',undefined,false)).data;assert.equal(pub.exercises[0].id,ex);assert.equal(pub.exercises[0].imagePath,undefined);
  r=await fetch(base+`media/${ex}/image`,{headers:{Range:'bytes=0-4'}});assert.equal(r.status,206);assert.equal(await r.text(),'media');
  const login=await req('login',{code:codes[0],pin:'test-pass'},false);assert.equal(login.status,200);
  const personal=(await req('state',undefined,false,login.cookie.split(';')[0])).data;assert.equal(personal.payments.length,1);assert.equal(personal.payments[0].memberId,a);assert.equal(personal.me.password,undefined);
  const admin=(await req('state')).data;assert.equal(admin.members[0].password,undefined);assert.equal(admin.attendance.length,1);assert.ok(admin.attendance[0].out);
  assert.equal((await req('backup',{})).status,200);
  await new Promise(r=>server.close(r));server=await start();base=`http://127.0.0.1:${server.address().port}/api/gym/`;
  const restored=(await req('state')).data;assert.equal(restored.members.length,2);assert.equal(restored.payments.length,2);assert.equal(restored.exercises[0].id,ex);
 } finally {await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
