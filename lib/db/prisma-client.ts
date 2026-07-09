import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Singleton perezoso de PrismaClient: se construye recien cuando algo lo pide
// (getPrismaClient()), no al importar este modulo. Esto evita que importar
// `lib/actions/auth.ts` en tests (que siempre inyectan un AuthService falso)
// dispare una conexion real a la base de datos. En dev, se cuelga de
// globalThis para no crear una conexion nueva en cada hot-reload de Next.js.
//
// Prisma 7 exige pasar un driver adapter al constructor para conexiones
// directas: usamos PrismaPg con la DATABASE_URL del entorno.
declare global {
  var __prisma__: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (!globalThis.__prisma__) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    globalThis.__prisma__ = new PrismaClient({ adapter });
  }
  return globalThis.__prisma__;
}
