import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function installGym(app, {root, isServer, dataDir = path.join(root, 'data')}) {
  fs.mkdirSync(dataDir, {recursive:true});
  const file = path.join(dataDir, 'gym.json');
  const empty = {version:1,settings:{name:'باشگاه من'},members:[],plans:[],subscriptions:[],payments:[],attendance:[],products:[],movements:[],expenses:[],exercises:[],devices:[],audit:[]};
  let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : empty;
  const sessions = new Map(), attempts = new Map();
  const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
  const str = (v,max=200) => typeof v==='string' ? v.trim().slice(0,max) : '';
  const required = (v,label,max=200) => {const s=str(v,max); if(!s)fail(`${label} را وارد کنید.`); return s;};
  const number = (v,min=0,max=1e12) => {if(v===''||v===null||v===undefined)fail('مقدار عددی لازم است.');const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)fail('مقدار عددی معتبر نیست.');return n;};
  const date = v => {const s=str(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)fail('تاریخ معتبر نیست.');return s;};
  const optionalDate = v => {const s=str(v,20);if(!s)return '';if(!/^[0-9۰-۹]{4}[\/-][0-9۰-۹]{1,2}[\/-][0-9۰-۹]{1,2}$/.test(s))fail('تاریخ تولد را مانند ۱۳۷۵/۰۶/۲۱ وارد کنید.');return s.replace(/-/g,'/');};
  const normalizeName = v => str(v,200).replace(/[\u200c\u200f\u202a-\u202e]/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('fa-IR');
  const ref = (type,id) => db[type].find(x=>x.id===id) || fail('رکورد انتخاب‌شده پیدا نشد.');
  const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function nextMemberCode() {
    const numbers = db.members.map(x => /^\d+$/.test(String(x.code||'')) ? Number(x.code) : 0);
    const next = Math.max(0, ...numbers) + 1;
    return String(next).padStart(Math.max(3, String(next).length), '0');
  }
  function save(next) {
    const temp=file+'.tmp';
    fs.writeFileSync(temp,JSON.stringify(next,null,2));
    if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak');
    fs.renameSync(temp,file);db=next;
  }
  const safeMember = ({password,...m}) => m;
  const token = req => /(?:^|;\s*)gym_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
  function member(req){const t=token(req),s=sessions.get(t);if(!s)return null;if(s.until<Date.now()){sessions.delete(t);return null;}return db.members.find(x=>x.id===s.id&&x.status==='active')||null;}
  function localWrite(req,res,next){if(!isServer(req))return res.status(403).json({error:'مدیریت فقط روی کامپیوتر سرور در دسترس است.'});next();}
  app.use('/api/gym',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(req.method!=='GET'){
      if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.sendStatus(403);}catch{return res.sendStatus(403);}}
      if(!req.is('application/json'))return res.status(415).json({error:'درخواست باید JSON باشد.'});
    }
    next();
  });
  const wrap = fn => (req,res,next)=>{try{fn(req,res);}catch(e){next(e);}};
  const publicExercise = x => ({id:x.id,title:x.title,group:x.group,deviceId:x.deviceId,description:x.description,steps:x.steps,notes:x.notes,image:!!x.imagePath,video:!!x.videoPath,status:x.status});
  app.get('/api/gym/state',wrap((req,res)=>{
    const m=member(req),admin=isServer(req);
    res.json(admin?{...db,members:db.members.map(safeMember),canManage:true,today:today(),me:null}:{settings:db.settings,canManage:false,today:today(),me:m?safeMember(m):null,exercises:db.exercises.filter(x=>x.status==='published').map(publicExercise),devices:db.devices,subscriptions:m?db.subscriptions.filter(x=>x.memberId===m.id):[],payments:m?db.payments.filter(x=>x.memberId===m.id):[],attendance:m?db.attendance.filter(x=>x.memberId===m.id).slice(-30):[]});
  }));
  app.post('/api/gym/login',wrap((req,res)=>{
    const ip=req.ip,now=Date.now();let a=attempts.get(ip);if(!a||a.until<now){a={count:0,until:now+10*60e3};attempts.set(ip,a);}if(a.count>=10)fail('تعداد تلاش زیاد است؛ ده دقیقه بعد امتحان کنید.',429);a.count++;
    const m=db.members.find(x=>x.code===str(req.body.code)&&x.status==='active');
    if(!m?.password)fail('کد عضویت یا رمز ورود درست نیست.',401);
    const [salt,hash]=m.password.split(':');const test=crypto.scryptSync(str(req.body.pin),salt,32);
    if(!crypto.timingSafeEqual(test,Buffer.from(hash,'hex')))fail('کد عضویت یا رمز ورود درست نیست.',401);
    attempts.delete(ip);const t=crypto.randomBytes(32).toString('hex');sessions.set(t,{id:m.id,until:now+8*3600e3});
    res.setHeader('Set-Cookie',`gym_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);res.json({ok:true});
  }));
  app.post('/api/gym/logout',wrap((req,res)=>{sessions.delete(token(req));res.setHeader('Set-Cookie','gym_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});}));
  function media(v,kind){if(!v)return '';const p=str(v,2000),extensions=kind==='image'?/\.(png|jpg|jpeg|webp)$/i:/\.(mp4|webm|m4v|mov|ogg)$/i;if(!path.isAbsolute(p)||!extensions.test(p)||!fs.existsSync(p)||!fs.statSync(p).isFile())fail('فایل انتخاب‌شده موجود نیست یا فرمت آن مناسب نیست.');return path.normalize(p);}
  const schemas = {
    members(b,old){const name=required(b.name,'نام و نام خانوادگی'),nameKey=normalizeName(name),phone=required(b.phone,'شماره تماس',30),nationalId=str(b.nationalId,20).replace(/\s/g,'');if(db.members.some(x=>x.id!==old?.id&&normalizeName(x.name)===nameKey))fail('این نام قبلاً ثبت شده است. برای فرد مشابه، نام کامل را دقیق‌تر وارد کنید.');if(db.members.some(x=>x.id!==old?.id&&x.phone===phone))fail('این شماره تماس قبلاً برای عضو دیگری ثبت شده است.');if(nationalId&&!/^\d{10}$/.test(nationalId))fail('کد ملی باید ۱۰ رقم باشد.');if(nationalId&&db.members.some(x=>x.id!==old?.id&&x.nationalId===nationalId))fail('این کد ملی قبلاً ثبت شده است.');const gender=['male','female'].includes(b.gender)?b.gender:(old?.gender||fail('جنسیت را انتخاب کنید.'));const code=old?.code||nextMemberCode();let password=old?.password||'';if(!old&&!b.pin)fail('رمز ورود را وارد کنید.');if(b.pin){if(str(b.pin).length<6)fail('رمز ورود باید دست‌کم ۶ نویسه باشد.');const salt=crypto.randomBytes(16).toString('hex');password=salt+':'+crypto.scryptSync(str(b.pin),salt,32).toString('hex');}return {name,nameKey,code,phone,nationalId,gender,birthDate:optionalDate(b.birthDate),trainer:str(b.trainer,120)||'آزاد',medicalNotes:str(b.medicalNotes,4000),photoPath:media(b.photoPath,'image'),receptionNote:str(b.receptionNote,3000),startDate:old?.startDate||today(),status:old?(b.status==='inactive'?'inactive':'active'):'active',password};},
    plans(b){return {title:required(b.title,'نام دوره'),days:number(b.days,1,730),fee:number(b.fee)};},
    subscriptions(b){const m=ref('members',b.memberId),p=ref('plans',b.planId);const start=date(b.start),end=new Date(start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+p.days-1);return {memberId:m.id,planId:p.id,title:p.title,start,end:end.toISOString().slice(0,10),fee:p.fee};},
    payments(b){ref('members',b.memberId);return {memberId:b.memberId,amount:number(b.amount,1),method:['cash','card','transfer'].includes(b.method)?b.method:'cash',note:str(b.note),date:date(b.date)};},
    products(b){return {title:required(b.title,'نام کالا'),unit:required(b.unit,'واحد'),minimum:number(b.minimum,0,1000000)};},
    movements(b){ref('products',b.productId);const delta=number(b.quantity,1,1000000)*(b.direction==='out'?-1:1);const balance=db.movements.filter(x=>x.productId===b.productId).reduce((s,x)=>s+x.delta,0);if(balance+delta<0)fail('موجودی برای خروج این تعداد کافی نیست.');return {productId:b.productId,delta,note:required(b.note,'علت گردش')};},
    expenses(b){return {title:required(b.title,'شرح هزینه'),category:str(b.category)||'سایر',amount:number(b.amount,1),date:date(b.date)};},
    devices(b){return {title:required(b.title,'نام دستگاه'),description:str(b.description,3000)};},
    exercises(b){if(b.deviceId)ref('devices',b.deviceId);return {title:required(b.title,'عنوان حرکت'),group:required(b.group,'گروه عضلانی'),deviceId:b.deviceId||'',description:str(b.description,4000),steps:str(b.steps,4000),notes:str(b.notes,3000),imagePath:media(b.imagePath,'image'),videoPath:media(b.videoPath,'video'),status:b.status==='published'?'published':'draft'};}
  };
  app.post('/api/gym/records/:type',localWrite,wrap((req,res)=>{
    const type=req.params.type;if(!schemas[type])fail('بخش نامعتبر است.');const old=req.body.id?ref(type,req.body.id):null;
    if(old&&['subscriptions','payments','movements','expenses'].includes(type))fail('رکورد مالی و گردش ثبت‌شده قابل بازنویسی نیست.');
    const record={...schemas[type](req.body,old),id:old?.id||crypto.randomUUID(),createdAt:old?.createdAt||new Date().toISOString()};
    const next=structuredClone(db);if(old)next[type][next[type].findIndex(x=>x.id===old.id)]=record;else next[type].push(record);
    next.audit.push({at:new Date().toISOString(),action:old?'update':'create',type,id:record.id});save(next);res.json({ok:true,id:record.id,code:record.code});
  }));
  app.post('/api/gym/attendance',localWrite,wrap((req,res)=>{
    const m=ref('members',req.body.memberId),open=db.attendance.find(x=>x.memberId===m.id&&!x.out);const next=structuredClone(db);
    if(open){next.attendance.find(x=>x.id===open.id).out=new Date().toISOString();}
    else {if(m.status!=='active')fail('عضو غیرفعال است.');if(!db.subscriptions.some(x=>x.memberId===m.id&&x.start<=today()&&x.end>=today()))fail('این عضو دوره معتبر ندارد؛ ابتدا عضویت را تمدید کنید.');next.attendance.push({id:crypto.randomUUID(),memberId:m.id,in:new Date().toISOString(),out:null});}
    next.audit.push({at:new Date().toISOString(),action:open?'checkout':'checkin',type:'attendance',id:m.id});save(next);res.json({ok:true});
  }));
  app.post('/api/gym/settings',localWrite,wrap((req,res)=>{const next=structuredClone(db);next.settings.name=required(req.body.name,'نام باشگاه');save(next);res.json({ok:true});}));
  app.post('/api/gym/backup',localWrite,wrap((req,res)=>{const folder=path.join(dataDir,'backups');fs.mkdirSync(folder,{recursive:true});const name=`gym-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;fs.writeFileSync(path.join(folder,name),JSON.stringify(db,null,2));res.json({ok:true,name});}));
  app.get('/api/gym/media/:id/:kind',wrap((req,res)=>{const x=ref('exercises',req.params.id);if(x.status!=='published'&&!isServer(req))return res.sendStatus(404);const file=req.params.kind==='image'?x.imagePath:req.params.kind==='video'?x.videoPath:null;if(!file||!fs.existsSync(file))return res.sendStatus(404);res.sendFile(file);}));
  app.use('/api/gym',(err,req,res,next)=>{console.error(err.message);res.status(err.status||500).json({error:err.status?err.message:'ذخیره یا خواندن اطلاعات انجام نشد؛ دوباره تلاش کنید.'});});
}
