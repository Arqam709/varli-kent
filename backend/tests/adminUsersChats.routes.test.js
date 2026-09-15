// Real routers, JWT authentication and permission checks; only database models are replaced.
import test, { before, after, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
const secret = 'batch7-test-only-secret-abcdefghijklmnopqrstuv'
process.env.JWT_SECRET = secret
const id = n => String(n).padStart(24, '0')
let users, conversations
const query = resolve => {
  let projection = ''
  const q = { select(p) { projection = p; return q }, populate() { return q }, sort() { return q }, skip() { return q }, limit() { return q }, then(ok, fail) {
    return Promise.resolve().then(() => {
      const result = resolve()
      const project = value => {
        if (!value || !projection) return value
        const copy = { ...value }
        for (const field of projection.split(' ')) if (field.startsWith('-')) delete copy[field.slice(1)]
        return copy
      }
      return Array.isArray(result) ? result.map(project) : project(result)
    }).then(ok, fail)
  } }
  return q
}
const makeUser = (n, role, permissions = []) => ({ _id: id(n), name: 'Fixture ' + n, role, permissions, isActive: true,
  password: 'existing-hash', resetPasswordToken: 'private-reset', resetPasswordExpires: 'private-expiry',
  async save() {}, toObject() { return { ...this } } })
mock.module('../models/User.js', { defaultExport: {
  find: () => query(() => users), findById: key => query(() => users.find(u => u._id === String(key)) || null),
  findByIdAndUpdate: (key, values) => query(() => Object.assign(users.find(u => u._id === key), values)),
  findByIdAndDelete: async key => { users = users.filter(u => u._id !== key) },
} })
mock.module('../models/ChatConversation.js', { defaultExport: {
  findById: key => query(() => conversations.find(c => c._id === key) || null),
  findOne: filter => query(() => conversations.find(c => Object.entries(filter).every(([k,v]) => c[k] === String(v))) || null),
  find: filter => query(() => conversations.filter(c => Object.entries(filter).every(([k,v]) => c[k] === String(v)))),
  countDocuments: async () => conversations.length,
  aggregate: async () => [{ data: [], totalCount: [] }],
} })
mock.module('../models/ChatMessage.js', { defaultExport: { find: () => query(() => [{ _id: id(90), role: 'user', text: 'Private fixture message' }]) } })
mock.module('../models/Property.js', { defaultExport: {} })
mock.module('../models/ContactSubmission.js', { defaultExport: {} })
let server, base
before(async () => {
  const app = express(); app.use(express.json())
  app.use('/users', (await import('../routes/users.js')).default)
  app.use('/admin/chats', (await import('../routes/adminChats.js')).default)
  app.use('/chat/conversations', (await import('../routes/chatConversations.js')).default)
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }))
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { await new Promise(resolve => server.close(resolve)) })
beforeEach(() => {
  users = [makeUser(1,'owner'), makeUser(2,'admin',['user_management','view_chats']), makeUser(3,'admin',['manage_passwords']),
    makeUser(4,'admin'), makeUser(5,'agent'), makeUser(6,'user'), makeUser(7,'user'), makeUser(8,'admin',['user_management','view_chats'])]
  users[7].isActive = false
  conversations = [{ _id: id(70), user: id(7), status: 'active' }]
})
async function request(actor, method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: 'Bearer ' + jwt.sign({ id: id(actor) }, secret) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: res.status, data: await res.json() }
}
for (const [actor, expected] of [[1,200],[2,200],[3,403],[4,403],[5,403],[6,403],[0,401],[8,401]]) {
  test(`user listing authorization actor ${actor}`, async () => {
    const r = await request(actor,'GET','/users'); assert.equal(r.status,expected)
    if(expected===200) for(const u of r.data.users) for(const key of ['password','resetPasswordToken','resetPasswordExpires']) assert.equal(key in u,false)
  })
  test(`private chat review authorization actor ${actor}`, async () => {
    for(const path of ['/admin/chats/users','/admin/chats/'+id(70)]) assert.equal((await request(actor,'GET',path)).status,expected)
  })
  test(`account deletion remains owner-only actor ${actor}`, async () => {
    const r=await request(actor,'DELETE','/users/'+id(7));assert.equal(r.status,actor===1?200:actor===0||actor===8?401:403)
    assert.equal(users.some(u=>u._id===id(7)),actor!==1)
  })
}
test('password permission is separate from user management; owner targets protected',async()=>{
  for(const actor of [1,3])assert.equal((await request(actor,'PUT','/users/'+id(7)+'/password',{newPassword:'fixture-password'})).status,200)
  for(const actor of [2,4,5,6])assert.equal((await request(actor,'PUT','/users/'+id(7)+'/password',{newPassword:'fixture-password'})).status,403)
  assert.equal((await request(3,'PUT','/users/'+id(1)+'/password',{newPassword:'fixture-password'})).status,403)
  assert.equal((await request(1,'PUT','/users/'+id(7)+'/password',{newPassword:'short'})).status,400)
})
test('agent promotion clears admin permissions; demotion and delegation preserve CURRENT hierarchy',async()=>{
  users[6].permissions=['view_chats']
  let r=await request(2,'PUT','/users/'+id(7)+'/role',{role:'agent'});assert.equal(r.status,200);assert.equal(r.data.user.role,'agent');assert.deepEqual(r.data.user.permissions,[]);assert.equal('password' in r.data.user,false)
  assert.equal((await request(2,'PUT','/users/'+id(7)+'/role',{role:'user'})).status,200)
  assert.equal((await request(2,'PUT','/users/'+id(7)+'/role',{role:'admin'})).status,403)
  assert.equal((await request(1,'PUT','/users/'+id(7)+'/role',{role:'admin'})).status,200)
  assert.equal((await request(1,'PUT','/users/'+id(7)+'/role',{role:'owner'})).status,403)
  assert.equal((await request(1,'DELETE','/users/'+id(1))).status,403)
})
test('permission grants intersect actor grants, and agents cannot receive admin permissions',async()=>{
  const r=await request(2,'PUT','/users/'+id(4)+'/permissions',{permissions:['view_chats','moderate_chats','manage_passwords']})
  assert.equal(r.status,200);assert.deepEqual(r.data.user.permissions,['view_chats']);assert.equal('password' in r.data.user,false)
  assert.equal((await request(1,'PUT','/users/'+id(5)+'/permissions',{permissions:['view_chats']})).status,403)
})
test('deactivation revokes JWT access and reactivation restores it',async()=>{
  assert.equal((await request(1,'PUT','/users/'+id(2)+'/role',{role:'admin',isActive:false})).status,200)
  assert.equal((await request(2,'GET','/users')).status,401)
  assert.equal((await request(2,'GET','/admin/chats/'+id(70))).status,401)
  assert.equal((await request(1,'PUT','/users/'+id(2)+'/role',{role:'admin',isActive:true})).status,200)
  assert.equal((await request(2,'GET','/users')).status,200)
})
test('normal users cannot read another user transcript; own transcript remains available',async()=>{
  assert.equal((await request(6,'GET','/chat/conversations/'+id(70))).status,404)
  const own=await request(7,'GET','/chat/conversations/'+id(70));assert.equal(own.status,200);assert.equal(own.data.messages[0].text,'Private fixture message')
})