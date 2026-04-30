/**
 * Seed script — idempotent.
 * Run: pnpm db:seed
 *
 * Creates:
 *  - 1 tenant + 1 store (from SEED_* env vars)
 *  - 4 users with PINs (owner=1234, manager=1234, baristas=1111/2222)
 *  - 6 categories
 *  - 16 products with modifiers
 *  - 22 inventory items
 *  - Recipes (BOM) for 15 products
 */

import 'dotenv/config'
import { PrismaClient, ModifierType, Role } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const adapter = new PrismaPg({ connectionString: url })
const db = new PrismaClient({ adapter })

const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'Kafé OS Demo'
const TENANT_SLUG = process.env.SEED_TENANT_SLUG ?? 'demo'
const STORE_NAME = process.env.SEED_STORE_NAME ?? 'Sukhumvit 49'
const STORE_SLUG = process.env.SEED_STORE_SLUG ?? 'suk49'

async function main() {
  console.log('🌱 Seeding...')

  // ─── Tenant + Store ─────────────────────────────────────
  const tenant = await db.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME },
    create: { slug: TENANT_SLUG, name: TENANT_NAME },
  })

  const store = await db.store.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: STORE_SLUG } },
    update: { name: STORE_NAME },
    create: {
      tenantId: tenant.id,
      slug: STORE_SLUG,
      name: STORE_NAME,
      address: 'ซ.สุขุมวิท 49 กรุงเทพฯ 10110',
      phone: '02-000-0000',
      // VAT designed-for, disabled until registered (DECISIONS.md D9)
      vatEnabled: false,
      vatRate: '7.00',
      promptpayId: null, // fill in after launch
    },
  })

  console.log(`  ✓ Tenant ${tenant.slug} • Store ${store.slug}`)

  // ─── Users ──────────────────────────────────────────────
  const hash = (pin: string) => bcrypt.hash(pin, 10)
  const users = [
    { email: 'owner@kafe.local',   name: 'เจ้าของร้าน',     pin: '1234', role: Role.OWNER },
    { email: 'manager@kafe.local', name: 'มาเนเจอร์',        pin: '1234', role: Role.MANAGER },
    { email: 'praew@kafe.local',   name: 'แพรว ส.',          pin: '1111', role: Role.BARISTA },
    { email: 'nut@kafe.local',     name: 'นัท',              pin: '2222', role: Role.BARISTA },
    { email: 'kong@kafe.local',    name: 'ก้อง',             pin: '3333', role: Role.BAKER },
  ]
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: {
        tenantId: tenant.id,
        storeId: store.id,
        email: u.email,
        name: u.name,
        pinHash: await hash(u.pin),
        role: u.role,
      },
    })
  }
  console.log(`  ✓ ${users.length} users`)

  // ─── Categories ─────────────────────────────────────────
  const cats = [
    { name: 'กาแฟร้อน', nameEn: 'Hot Coffee',   icon: 'flame',     order: 1 },
    { name: 'กาแฟเย็น', nameEn: 'Iced Coffee',  icon: 'snowflake', order: 2 },
    { name: 'ชา',       nameEn: 'Tea',          icon: 'leaf',      order: 3 },
    { name: 'เบเกอรี่', nameEn: 'Bakery',       icon: 'cake',      order: 4 },
    { name: 'อื่นๆ',    nameEn: 'Other',        icon: 'dots',      order: 5 },
  ]
  const catIds: Record<string, string> = {}
  for (const c of cats) {
    const row = await db.category.upsert({
      where: { storeId_name: { storeId: store.id, name: c.name } },
      update: { nameEn: c.nameEn, icon: c.icon, sortOrder: c.order },
      create: { storeId: store.id, name: c.name, nameEn: c.nameEn, icon: c.icon, sortOrder: c.order },
    })
    catIds[c.name] = row.id
  }
  console.log(`  ✓ ${cats.length} categories`)

  // ─── Inventory items ────────────────────────────────────
  type Inv = { sku: string; name: string; unit: string; cost: string; stock: string; par: string }
  const inventory: Inv[] = [
    { sku: 'inv-arabica',  name: 'เมล็ดกาแฟ Arabica',     unit: 'g',   cost: '0.5000', stock: '480',   par: '1500' },
    { sku: 'inv-robusta',  name: 'เมล็ดกาแฟ Robusta',     unit: 'g',   cost: '0.3000', stock: '1200',  par: '1000' },
    { sku: 'inv-milk',     name: 'นมสด',                   unit: 'ml',  cost: '0.0600', stock: '8400',  par: '4000' },
    { sku: 'inv-oat',      name: 'นมโอ๊ต Oatside',         unit: 'ml',  cost: '0.1800', stock: '2100',  par: '4000' },
    { sku: 'inv-almond',   name: 'นมอัลมอนด์',             unit: 'ml',  cost: '0.2000', stock: '1800',  par: '2000' },
    { sku: 'inv-matcha',   name: 'ผงมัทฉะ',                unit: 'g',   cost: '1.2000', stock: '320',   par: '300' },
    { sku: 'inv-tea',      name: 'ใบชาดำ',                 unit: 'g',   cost: '0.4000', stock: '850',   par: '500' },
    { sku: 'inv-sugar',    name: 'น้ำตาล',                 unit: 'g',   cost: '0.0400', stock: '5200',  par: '3000' },
    { sku: 'inv-caramel',  name: 'น้ำเชื่อมคาราเมล',       unit: 'ml',  cost: '0.5000', stock: '1600',  par: '1000' },
    { sku: 'inv-cocoa',    name: 'ผงโกโก้',                unit: 'g',   cost: '0.8000', stock: '540',   par: '500' },
    { sku: 'inv-whip',     name: 'วิปครีม',                unit: 'ml',  cost: '0.3000', stock: '980',   par: '500' },
    { sku: 'inv-ice',      name: 'น้ำแข็ง',                unit: 'g',   cost: '0.0100', stock: '50000', par: '20000' },
    { sku: 'inv-cup-hot',  name: 'แก้วร้อน 12 oz',         unit: 'ใบ',  cost: '2.5000', stock: '320',   par: '200' },
    { sku: 'inv-cup-cold', name: 'แก้วเย็น 16 oz',         unit: 'ใบ',  cost: '3.0000', stock: '38',    par: '100' },
    { sku: 'inv-lid',      name: 'ฝาแก้ว',                 unit: 'ใบ',  cost: '0.8000', stock: '720',   par: '300' },
    { sku: 'inv-straw',    name: 'หลอด',                   unit: 'อัน', cost: '0.3000', stock: '1200',  par: '300' },
    { sku: 'inv-croissant',name: 'ครัวซองต์ดิบ (พรีเบค)',  unit: 'ชิ้น',cost: '18.0000',stock: '24',    par: '20' },
    { sku: 'inv-brownie',  name: 'บราวนี่ดิบ',             unit: 'ชิ้น',cost: '22.0000',stock: '18',    par: '15' },
    { sku: 'inv-cookie',   name: 'คุกกี้ดิบ',              unit: 'ชิ้น',cost: '12.0000',stock: '36',    par: '20' },
    { sku: 'inv-cheese',   name: 'ชีสเค้กดิบ',             unit: 'ชิ้น',cost: '35.0000',stock: '8',     par: '10' },
    { sku: 'inv-soda',     name: 'โซดา',                   unit: 'ml',  cost: '0.0400', stock: '4200',  par: '2000' },
    { sku: 'inv-lemon',    name: 'น้ำมะนาวคั้น',           unit: 'ml',  cost: '0.3500', stock: '580',   par: '500' },
  ]
  const invIds: Record<string, string> = {}
  for (const i of inventory) {
    const row = await db.inventoryItem.upsert({
      where: { storeId_name: { storeId: store.id, name: i.name } },
      update: { unit: i.unit, costPerUnit: i.cost, parLevel: i.par },
      create: {
        storeId: store.id,
        name: i.name,
        unit: i.unit,
        costPerUnit: i.cost,
        stockOnHand: i.stock,
        parLevel: i.par,
      },
    })
    invIds[i.sku] = row.id
  }
  console.log(`  ✓ ${inventory.length} inventory items`)

  // ─── Modifier groups (shared by many drinks) ────────────
  type ModOpt = { name: string; delta: string; isDefault?: boolean; invSku?: string; invQty?: string }
  type ModGrp = { name: string; type: ModifierType; required: boolean; min: number; max: number; opts: ModOpt[]; sort: number }
  const modGroups: ModGrp[] = [
    {
      name: 'ขนาด', type: ModifierType.RADIO, required: true, min: 1, max: 1, sort: 1,
      opts: [
        { name: 'S', delta: '-5' },
        { name: 'M', delta: '0', isDefault: true },
        { name: 'L', delta: '10' },
      ],
    },
    {
      name: 'นม', type: ModifierType.RADIO, required: true, min: 1, max: 1, sort: 2,
      opts: [
        { name: 'นมสด',       delta: '0',  isDefault: true, invSku: 'inv-milk',   invQty: '0' },
        { name: 'นมโอ๊ต',     delta: '10', invSku: 'inv-oat',    invQty: '0' },
        { name: 'นมอัลมอนด์', delta: '15', invSku: 'inv-almond', invQty: '0' },
        { name: 'นมพร่อง',    delta: '0' },
      ],
    },
    {
      name: 'ความหวาน', type: ModifierType.RADIO, required: false, min: 0, max: 1, sort: 3,
      opts: [
        { name: 'ไม่หวาน', delta: '0' },
        { name: 'น้อย',    delta: '0' },
        { name: 'ปกติ',    delta: '0', isDefault: true },
        { name: 'มาก',     delta: '0' },
      ],
    },
    {
      name: 'เพิ่มเติม', type: ModifierType.CHECKBOX, required: false, min: 0, max: 4, sort: 4,
      opts: [
        { name: 'เพิ่มช็อต', delta: '15', invSku: 'inv-arabica', invQty: '9' },
        { name: 'วิปครีม',   delta: '10', invSku: 'inv-whip',    invQty: '20' },
        { name: 'มุก',       delta: '10' },
        { name: 'เยลลี่',    delta: '5' },
      ],
    },
  ]
  const modGroupIds: Record<string, string> = {}
  for (const g of modGroups) {
    // upsert group (cleanup options first to keep idempotent)
    const grp = await db.modifierGroup.findFirst({
      where: { storeId: store.id, name: g.name },
    })
    let groupId: string
    if (grp) {
      groupId = grp.id
      await db.modifier.deleteMany({ where: { groupId } })
      await db.modifierGroup.update({
        where: { id: groupId },
        data: { type: g.type, isRequired: g.required, minSelect: g.min, maxSelect: g.max, sortOrder: g.sort },
      })
    } else {
      const row = await db.modifierGroup.create({
        data: {
          storeId: store.id, name: g.name, type: g.type,
          isRequired: g.required, minSelect: g.min, maxSelect: g.max, sortOrder: g.sort,
        },
      })
      groupId = row.id
    }
    modGroupIds[g.name] = groupId

    for (let i = 0; i < g.opts.length; i++) {
      const o = g.opts[i]
      await db.modifier.create({
        data: {
          groupId,
          name: o.name,
          priceDelta: o.delta,
          isDefault: o.isDefault ?? false,
          inventoryItemId: o.invSku ? invIds[o.invSku] : null,
          inventoryQty: o.invQty ?? null,
          sortOrder: i,
        },
      })
    }
  }
  console.log(`  ✓ ${modGroups.length} modifier groups`)

  // ─── Products + recipes ─────────────────────────────────
  type Recipe = { invSku: string; qty: string }
  type Prod = {
    sku: string; name: string; nameEn: string; cat: string; price: string;
    color: string; tag: string; featured?: boolean; mods: string[]; recipe: Recipe[];
  }
  const products: Prod[] = [
    { sku: 'm1',  name: 'เอสเปรสโซ',         nameEn: 'Espresso',           cat: 'กาแฟร้อน', price: '55', color: '#3D2817', tag: 'C1', mods: ['ความหวาน', 'เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-cup-hot', qty: '1' }] },
    { sku: 'm2',  name: 'ลาเต้',              nameEn: 'Latte',              cat: 'กาแฟร้อน', price: '75', color: '#A57854', tag: 'C2', featured: true, mods: ['ขนาด','นม','ความหวาน','เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-milk', qty: '200' }, { invSku: 'inv-cup-hot', qty: '1' }, { invSku: 'inv-sugar', qty: '5' }] },
    { sku: 'm3',  name: 'คาปูชิโน',           nameEn: 'Cappuccino',         cat: 'กาแฟร้อน', price: '75', color: '#8B6F47', tag: 'C3', mods: ['ขนาด','นม','ความหวาน','เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-milk', qty: '150' }, { invSku: 'inv-cup-hot', qty: '1' }] },
    { sku: 'm4',  name: 'มอคค่า',             nameEn: 'Mocha',              cat: 'กาแฟร้อน', price: '85', color: '#5C3B22', tag: 'C4', mods: ['ขนาด','นม','ความหวาน','เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-milk', qty: '200' }, { invSku: 'inv-cocoa', qty: '10' }, { invSku: 'inv-whip', qty: '20' }, { invSku: 'inv-cup-hot', qty: '1' }] },
    { sku: 'm5',  name: 'อเมริกาโน่ เย็น',    nameEn: 'Iced Americano',     cat: 'กาแฟเย็น', price: '70', color: '#2A1A0F', tag: 'D1', featured: true, mods: ['ขนาด','ความหวาน'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-ice', qty: '200' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm6',  name: 'ลาเต้ เย็น',         nameEn: 'Iced Latte',         cat: 'กาแฟเย็น', price: '80', color: '#B89878', tag: 'D2', mods: ['ขนาด','นม','ความหวาน','เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-milk', qty: '180' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm7',  name: 'คาราเมล มัคคิอาโต',  nameEn: 'Caramel Macchiato',  cat: 'กาแฟเย็น', price: '95', color: '#C49A6E', tag: 'D3', mods: ['ขนาด','นม','ความหวาน','เพิ่มเติม'], recipe: [{ invSku: 'inv-arabica', qty: '18' }, { invSku: 'inv-milk', qty: '200' }, { invSku: 'inv-caramel', qty: '30' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm8',  name: 'ชาเขียวมัทฉะลาเต้',  nameEn: 'Matcha Latte',       cat: 'ชา',       price: '90', color: '#7FA572', tag: 'T1', mods: ['ขนาด','นม','ความหวาน'], recipe: [{ invSku: 'inv-matcha', qty: '10' }, { invSku: 'inv-milk', qty: '200' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm9',  name: 'ชาไทย เย็น',         nameEn: 'Thai Iced Tea',      cat: 'ชา',       price: '65', color: '#D88B4E', tag: 'T2', mods: ['ขนาด','ความหวาน'], recipe: [{ invSku: 'inv-tea', qty: '8' }, { invSku: 'inv-milk', qty: '100' }, { invSku: 'inv-sugar', qty: '15' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm10', name: 'ชามะนาว',            nameEn: 'Lemon Tea',          cat: 'ชา',       price: '55', color: '#E8C875', tag: 'T3', mods: [], recipe: [{ invSku: 'inv-tea', qty: '8' }, { invSku: 'inv-lemon', qty: '20' }, { invSku: 'inv-sugar', qty: '10' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
    { sku: 'm11', name: 'ครัวซองต์',          nameEn: 'Croissant',          cat: 'เบเกอรี่', price: '65', color: '#D9A766', tag: 'B1', mods: [], recipe: [{ invSku: 'inv-croissant', qty: '1' }] },
    { sku: 'm12', name: 'บราวนี่',            nameEn: 'Brownie',            cat: 'เบเกอรี่', price: '75', color: '#4A2C1A', tag: 'B2', mods: [], recipe: [{ invSku: 'inv-brownie', qty: '1' }] },
    { sku: 'm13', name: 'คุกกี้ช็อกชิป',     nameEn: 'Choc Chip Cookie',   cat: 'เบเกอรี่', price: '45', color: '#9A6E3F', tag: 'B3', mods: [], recipe: [{ invSku: 'inv-cookie', qty: '1' }] },
    { sku: 'm14', name: 'ชีสเค้ก',            nameEn: 'Cheesecake',         cat: 'เบเกอรี่', price: '95', color: '#F2DDA4', tag: 'B4', mods: [], recipe: [{ invSku: 'inv-cheese', qty: '1' }] },
    { sku: 'm15', name: 'น้ำเปล่า',           nameEn: 'Water',              cat: 'อื่นๆ',   price: '20', color: '#9CB7C4', tag: 'O1', mods: [], recipe: [] },
    { sku: 'm16', name: 'โซดามะนาว',          nameEn: 'Lemon Soda',         cat: 'อื่นๆ',   price: '55', color: '#B8D58E', tag: 'O2', mods: [], recipe: [{ invSku: 'inv-soda', qty: '200' }, { invSku: 'inv-lemon', qty: '25' }, { invSku: 'inv-sugar', qty: '10' }, { invSku: 'inv-ice', qty: '150' }, { invSku: 'inv-cup-cold', qty: '1' }, { invSku: 'inv-lid', qty: '1' }, { invSku: 'inv-straw', qty: '1' }] },
  ]

  let prodCount = 0
  let recipeCount = 0
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    const product = await db.product.upsert({
      where: { storeId_sku: { storeId: store.id, sku: p.sku } },
      update: {
        name: p.name, nameEn: p.nameEn, basePrice: p.price,
        colorHex: p.color, badgeTag: p.tag, isFeatured: p.featured ?? false,
        sortOrder: i, categoryId: catIds[p.cat],
      },
      create: {
        storeId: store.id, sku: p.sku,
        name: p.name, nameEn: p.nameEn, basePrice: p.price,
        colorHex: p.color, badgeTag: p.tag, isFeatured: p.featured ?? false,
        sortOrder: i, categoryId: catIds[p.cat],
      },
    })
    prodCount++

    // wipe and recreate recipe + modifier links (idempotent)
    await db.recipeItem.deleteMany({ where: { productId: product.id } })
    for (const r of p.recipe) {
      await db.recipeItem.create({
        data: { productId: product.id, inventoryItemId: invIds[r.invSku], quantity: r.qty },
      })
      recipeCount++
    }

    await db.productModifierGroup.deleteMany({ where: { productId: product.id } })
    for (let j = 0; j < p.mods.length; j++) {
      await db.productModifierGroup.create({
        data: { productId: product.id, groupId: modGroupIds[p.mods[j]], sortOrder: j },
      })
    }
  }
  console.log(`  ✓ ${prodCount} products, ${recipeCount} recipe items`)
  console.log('🌱 Seeding complete.')
}

main()
  .catch(async (e) => {
    console.error('❌ Seed failed:', e)
    await db.$disconnect()
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
