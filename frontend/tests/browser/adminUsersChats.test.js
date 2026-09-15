import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { env } from 'node:process'
import translations from '../../src/locales/translations.js'
let server, browser, base
const screenshots=join(tmpdir(),'varlikent-batch7-visuals')
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {LanguageProvider} from '/src/contexts/LanguageContext.jsx'; import {AuthProvider} from '/src/contexts/AuthContext.jsx'; import {ThemeProvider} from '/src/contexts/ThemeContext.jsx';
import ProtectedRoute from '/src/components/ProtectedRoute.jsx'; import AdminUsers from '/src/pages/AdminUsers.jsx'; import AdminUserChats from '/src/pages/AdminUserChats.jsx'; import {ToastContainer} from 'react-toastify'; import '/src/index.css';
const e=React.createElement, chats=location.search.includes('chats');
createRoot(document.getElementById('root')).render(e(MemoryRouter,{initialEntries:[chats?'/admin/user-chats':'/admin/users']},e(LanguageProvider,null,e(AuthProvider,null,e(ThemeProvider,null,e(React.Fragment,null,e(ToastContainer),e(Routes,null,e(Route,{path:'/admin/*',element:e(ProtectedRoute,{requiredRole:'admin'},e(chats?AdminUserChats:AdminUsers))}),e(Route,{path:'*',element:e('p',null,'Access redirected')}))))))));
</script></body></html>`
before(async()=>{
  await mkdir(screenshots,{recursive:true})
  server=await createServer({logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'batch7-fixture',enforce:'pre',async load(id){
    const path=id.replaceAll('\\','/')
    if(path.endsWith('/src/index.css'))return (await readFile(id,'utf8')).replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source ".";')
    if(env.BATCH7_MUTATION && /\/src\/pages\/Admin(UserChats|Users)\.jsx$/.test(path)) {
      let s=await readFile(id,'utf8')
      if(env.BATCH7_MUTATION==='scroll')s=s.replaceAll('vk-scroll-gold ','')
      if(env.BATCH7_MUTATION==='grant')s=s.replace('perms.filter(({ key }) => isOwner || currentUser?.permissions?.includes(key))','perms')
      if(env.BATCH7_MUTATION==='selection')s=s.replace('      setSelectedConversationId(null)'+String.fromCharCode(13,10)+'      setConversations([])', '      setConversations([])')
      if(env.BATCH7_MUTATION==='response')s=s.replace('u._id === permModal._id ? res.data.user : u','u._id === permModal._id ? { ...u, permissions: tempPerms } : u')
      return s
    }
  },configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
    if(!req.url.startsWith('/__batch7.html')||req.url.includes('html-proxy'))return next()
    try{res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__batch7.html',html))}catch(error){next(error)}
  })}}]});await server.listen();base=`http://127.0.0.1:${server.httpServer.address().port}`;browser=await chromium.launch({headless:true})
})
after(async()=>{await browser?.close();await server?.close()})
const record=(id,name,role='user',permissions=[])=>({_id:id,name,email:id+'@example.test',role,permissions,isActive:true,createdAt:'2026-01-01'})
async function setup(t,kind='users',language='en',role='owner',permissions=[]){
  const page=await browser.newPage({viewport:{width:1440,height:850}});page.setDefaultTimeout(10000); t.after(()=>page.close()); page.on('pageerror',error=>console.error('Fixture page error:',error.message))
  const actor=record('actor','Fixture Operator',role,permissions)
  const state={calls:[],failList:false,failSave:false,sanitize:false,users:[record('admin','Target Admin','admin',['view_chats']),record('agent','Target Agent','agent'),record('buyer','Buyer Alice'),record('bob','Buyer Bob')],conversations:Array.from({length:20},(_,i)=>({_id:'conversation-'+i,user:'buyer',status:'active',messageCount:40,createdAt:'2026-01-01',lastActivityAt:'2026-09-15',lastMessage:{text:'Fixture conversation '+i}}))}
  await page.addInitScript(({actor,language})=>{localStorage.setItem('varlikent_token','fixture-token');localStorage.setItem('varlikent_user',JSON.stringify(actor));localStorage.setItem('vk_lang',language)},{actor,language})
  await page.route('**/*',async route=>{
    const r=route.request(),url=new URL(r.url()),path=url.pathname.split('/api')[1],method=r.method()
    if(url.pathname.includes('/api/')){
      const data=r.headers()['content-type']?.includes('application/json')?r.postDataJSON():null
      state.calls.push({path,method,data,params:Object.fromEntries(url.searchParams)})
      if(path==='/auth/me')return route.fulfill({json:{user:actor}})
      if(path==='/users'&&method==='GET')return route.fulfill(state.failList?{status:500,json:{message:'Fixture unavailable'}}:{json:{users:state.users}})
      if(path.startsWith('/users/')&&method==='PUT'){
        if(state.failSave)return route.fulfill({status:403,json:{message:'Fixture action denied'}})
        const id=path.split('/')[2],user=state.users.find(u=>u._id===id)
        Object.assign(user,data)
        if(data.permissions&&state.sanitize)user.permissions=['view_chats']
        if(data.role==='agent')user.permissions=[]
        return route.fulfill({json:{user}})
      }
      if(path.startsWith('/users/')&&method==='DELETE'){
        if(state.failSave)return route.fulfill({status:403,json:{message:'Fixture action denied'}})
        state.users=state.users.filter(u=>u._id!==path.split('/')[2]);return route.fulfill({json:{success:true}})
      }
      if(path==='/admin/chats/users')return route.fulfill({json:{users:(state.hideUsers?[]:state.users.filter(u=>u.role==='user')).map(user=>({user,conversationCount:state.conversations.length,lastActivityAt:'2026-09-15',latestMessage:{text:'Latest fixture'}})),pagination:{page:Number(url.searchParams.get('page')),totalPages:state.totalPages||2,totalCount:22}}})
      if(path==='/admin/chats'&&method==='GET')return route.fulfill({json:{conversations:state.conversations,pagination:{page:Number(url.searchParams.get('page')),totalPages:state.totalPages||2,totalCount:21}}})
      if(path.startsWith('/admin/chats/')&&method==='DELETE'){
        if(state.failSave)return route.fulfill({status:403,json:{message:'Fixture action denied'}})
        state.conversations=path.includes('/user/')?[]:state.conversations.filter(c=>c._id!==path.split('/').pop())
        return route.fulfill({json:{success:true,deletedCount:1}})
      }
      if(path.startsWith('/admin/chats/')&&method==='GET')return route.fulfill({json:{conversation:{...state.conversations.find(c=>c._id===path.split('/').pop()),user:state.users[2]},messages:Array.from({length:40},(_,i)=>({_id:'message-'+i,role:i%2?'assistant':'user',text:'Private fixture message '+i,createdAt:'2026-09-15T10:00:00Z'}))}})
      return route.fulfill({json:{success:true}})
    }
    return url.origin===base?route.continue():route.abort()
  })
  await page.goto(base+'/__batch7.html?'+kind,{waitUntil:'domcontentloaded',timeout:60000})
  return {page,state}
}
const card=(page,name)=>page.locator('div.rounded-2xl').filter({has:page.getByText(name,{exact:true})}).last()
async function snap(page,name){await page.screenshot({path:join(screenshots,name+'.png')})}
async function scroll(panel){await expect(panel).toHaveCSS('scrollbar-width','thin');await panel.evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(await panel.evaluate(el=>el.scrollTop>0),'panel actually scrolls')}
for(const language of ['en','tr','ar','de','ru','ur'])test('permission shortcuts, localized confirmation and RTL: '+language,async t=>{
  const {page,state}=await setup(t,'users',language);const p=translations[language].adminPages.users,c=translations[language].adminPages.common
  await expect(page.getByText('Target Agent',{exact:true})).toBeVisible({timeout:30000})
  await snap(page,'users-desktop-'+language)
  await card(page,'Target Admin').getByRole('button',{name:p.permissions,exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:p.selectAll,exact:true}).first().click()
  for(const name of ['Add Listing','Edit Listing','Delete Listing','Mark Featured','Manage Images'])await expect(dialog.getByRole('checkbox',{name,exact:true})).toBeChecked()
  await dialog.getByRole('button',{name:p.selectNone,exact:true}).first().click()
  await expect(dialog.getByRole('checkbox',{name:'Add Listing',exact:true})).not.toBeChecked()
  await page.setViewportSize({width:390,height:500});await expect(page.locator('html')).toHaveAttribute('dir',['ar','ur'].includes(language)?'rtl':'ltr')
  await scroll(dialog.locator('.overflow-y-auto'));await snap(page,'permissions-mobile-'+language)
  await dialog.getByRole('button',{name:c.cancel,exact:true}).click()
  await snap(page,'users-mobile-'+language)
  assert.equal(state.calls.some(c=>c.method==='PUT'),false)
  await card(page,'Buyer Alice').getByRole('button',{name:p.deactivate,exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText(p.deactivateConfirm.replace('{name}','Buyer Alice'))
  await snap(page,'confirmation-mobile-'+language)
  await page.getByRole('dialog').getByRole('button',{name:p.confirm,exact:true}).click()
  await expect(card(page,'Buyer Alice').getByRole('button',{name:p.reactivate,exact:true})).toBeVisible()
  assert.ok(state.calls.some(c=>c.path==='/users/buyer/role'&&c.data.isActive===false))
})
test('delegated shortcuts cannot grant missing permissions and UI uses server response',async t=>{
  const {page,state}=await setup(t,'users','en','admin',['user_management','view_chats']);state.sanitize=true
  await card(page,'Target Admin').getByRole('button',{name:'Permissions',exact:true}).click()
  let dialog=page.getByRole('dialog')
  const listing=dialog.getByText('Listings',{exact:true}).locator('..')
  await expect(listing.getByRole('button',{name:'Select all'})).toBeDisabled()
  await expect(dialog.getByRole('checkbox',{name:'Moderate AI Chats (delete chatbot history)',exact:true})).toBeDisabled()
  await dialog.getByRole('checkbox',{name:'User Management',exact:true}).check()
  await dialog.getByRole('button',{name:'Save Changes',exact:true}).click()
  await card(page,'Target Admin').getByRole('button',{name:'Permissions',exact:true}).click()
  dialog=page.getByRole('dialog');await expect(dialog.getByRole('checkbox',{name:'User Management',exact:true})).not.toBeChecked()
  assert.ok(state.calls.some(c=>c.path==='/users/admin/permissions'))
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0)
  await card(page,'Buyer Alice').getByRole('combobox').selectOption('agent')
  await expect(card(page,'Buyer Alice').getByRole('combobox')).toHaveValue('agent')
  state.failSave=true;await card(page,'Buyer Alice').getByRole('combobox').selectOption('user')
  await expect(page.getByText('Fixture action denied',{exact:true})).toBeVisible();await expect(card(page,'Buyer Alice').getByRole('combobox')).toHaveValue('agent')
})
test('user load failures are visible and retry restores data',async t=>{
  const {page,state}=await setup(t);state.failList=true;await page.reload()
  await expect(page.getByRole('alert')).toContainText(translations.en.adminPages.users.loadFailed)
  await expect(page.getByText('No users match your search.',{exact:true})).toHaveCount(0)
  state.failList=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByText('Target Agent',{exact:true})).toBeVisible()
})
for(const language of ['en','ur'])test('chat scroll, filters, pagination and moderation: '+language,async t=>{
  const {page,state}=await setup(t,'chats',language);const p=translations[language].adminPages.userChats
  await page.getByRole('button',{name:/Buyer Alice,/}).click()
  await page.getByRole('button',{name:/Fixture conversation 0 /}).click()
  await expect(page.getByText('Private fixture message 0',{exact:true})).toBeVisible()
  const panels=page.locator('.vk-scroll-gold.overscroll-contain');await expect(panels).toHaveCount(3)
  await scroll(panels.nth(1));await scroll(panels.nth(2));await snap(page,'chats-desktop-'+language)
  await page.setViewportSize({width:390,height:650});await snap(page,'chats-transcript-mobile-'+language)
  await page.getByRole('button',{name:p.deleteConversation||'Delete conversation',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:p.cancel||'Cancel',exact:true}).click()
  assert.equal(state.calls.some(c=>c.method==='DELETE'),false)
  await page.getByRole('button',{name:p.deleteConversation||'Delete conversation',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:p.confirm||'Confirm',exact:true}).click()
  await expect.poll(()=>state.calls.filter(c=>c.path==='/admin/chats/users').length).toBeGreaterThan(1)
  await expect(page.getByRole('button',{name:/Fixture conversation 0 /})).toHaveCount(0)
  await snap(page,'chats-conversations-mobile-'+language)
  await page.getByRole('button',{name:p.clearUserHistory||"Clear this user's AI chats",exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:p.cancel||'Cancel',exact:true}).click()
  await page.getByRole('button',{name:p.backToUsers||'Back to users',exact:true}).click()
  await snap(page,'chats-users-mobile-'+language)
  await page.setViewportSize({width:1440,height:850})
  await page.getByRole('button',{name:p.next||'Next',exact:true}).first().click()
  await expect.poll(()=>state.calls.some(c=>c.path==='/admin/chats/users'&&c.params.page==='2')).toBe(true)
  await page.getByRole('button',{name:p.leadsOnly||'Leads only',exact:true}).click()
  await expect.poll(()=>state.calls.some(c=>c.path==='/admin/chats/users'&&c.params.leadCaptured==='true'&&c.params.page==='1')).toBe(true)
  await page.getByRole('textbox').fill('Alice')
  await expect.poll(()=>state.calls.some(c=>c.path==='/admin/chats/users'&&c.params.search==='Alice')).toBe(true)
  await snap(page,'chats-filter-'+language)
})
test('view-only admins can read without moderation controls',async t=>{
  const {page}=await setup(t,'chats','en','admin',['view_chats']);await page.getByRole('button',{name:/Buyer Alice,/}).click();await page.getByRole('button',{name:/Fixture conversation 0 /}).click()
  await expect(page.getByText('Private fixture message 0',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Delete conversation',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:"Clear this user's AI chats",exact:true})).toHaveCount(0)
})
for(const role of ['agent','user'])test(role+' is redirected from admin routes',async t=>{
  for(const kind of ['users','chats']){const {page,state}=await setup(t,kind,'en',role);await expect(page.getByText('Access redirected')).toBeVisible();assert.equal(state.calls.some(c=>c.path==='/users'||c.path.startsWith('/admin/chats')),false)}
})
test('filtering away the selected user clears the private transcript',async t=>{
  const {page,state}=await setup(t,'chats');await page.getByRole('button',{name:/Buyer Alice,/}).click();await page.getByRole('button',{name:/Fixture conversation 0 /}).click()
  await expect(page.getByText('Private fixture message 0',{exact:true})).toBeVisible()
  state.hideUsers=true;await page.getByRole('textbox').fill('Nobody')
  await expect.poll(()=>state.calls.some(c=>c.path==='/admin/chats/users'&&c.params.search==='Nobody')).toBe(true)
  await expect(page.getByText('Private fixture message 0',{exact:true})).toHaveCount(0)
})

test('deletion refresh clamps both paginated lists after the last page disappears',async t=>{
  const {page,state}=await setup(t,'chats');await page.getByRole('button',{name:/Buyer Alice,/}).click()
  await page.getByRole('button',{name:'Next',exact:true}).first().click()
  await page.getByRole('button',{name:'Next',exact:true}).last().click()
  await expect.poll(()=>state.calls.some(c=>c.path==='/admin/chats'&&c.params.page==='2')).toBe(true)
  await page.getByRole('button',{name:/Fixture conversation 0 /}).click()
  await page.getByRole('button',{name:'Delete conversation',exact:true}).click()
  state.totalPages=1;const start=state.calls.length
  await page.getByRole('dialog').getByRole('button',{name:translations.en.adminPages.userChats.confirm||'Delete',exact:true}).click()
  for(const path of ['/admin/chats','/admin/chats/users'])await expect.poll(()=>state.calls.slice(start).some(c=>c.path===path&&c.params.page==='1')).toBe(true)
})
