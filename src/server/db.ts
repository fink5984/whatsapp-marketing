import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 10) });
  return new PrismaClient({ adapter });
}

/** Lazily-created singleton (survives Next.js dev hot reloads). */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.__prisma) globalForPrisma.__prisma = createClient();
    const value = Reflect.get(globalForPrisma.__prisma, prop);
    return typeof value === "function" ? value.bind(globalForPrisma.__prisma) : value;
  },
});

export async function disconnectDb() {
  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
    globalForPrisma.__prisma = undefined;
  }
}
