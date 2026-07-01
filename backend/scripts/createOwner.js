import dotenv from 'dotenv'
import mongoose from 'mongoose'
import User from '../models/User.js'
import connectDB from '../config/db.js'

dotenv.config()

const email = process.argv[2]
const password = process.argv[3]
const name = process.argv[4] || 'Owner'

if (!email || !password) {
  console.error('Usage: node scripts/createOwner.js <email> <password> [name]')
  process.exit(1)
}

const run = async () => {
  await connectDB()

  const existing = await User.findOne({ email })
  if (existing) {
    existing.role = 'owner'
    existing.permissions = []
    await existing.save()
    console.log(`✓ User ${email} promoted to owner`)
  } else {
    await User.create({ name, email, password, role: 'owner', permissions: [] })
    console.log(`✓ Owner account created: ${email}`)
  }

  await mongoose.disconnect()
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
