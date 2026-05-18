import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Prisma 7 — connection URL is now configured here, not in schema.prisma.
// Used by `prisma migrate`, `prisma db push`, `prisma studio`.
// Application code creates its own PrismaClient with adapter (see src/lib/db.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
