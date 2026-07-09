import { PrismaClient } from "@prisma/client";

// Singleton perezoso de PrismaClient: se construye recien cuando algo lo pide
// (getPrismaClient()), no al importar este modulo. Esto evita que importar
// `lib/actions/auth.ts` en tests (que siempre inyectan un AuthService falso)
// dispare una conexion real a la base de datos. En dev, se cuelga de
// globalThis para no crear una conexion nueva en cada hot-reload de Next.js.
declare global {
  var __prisma__: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (!globalThis.__prisma__) {
    globalThis.__prisma__ = new PrismaClient();
  }
  return globalThis.__prisma__;
}
