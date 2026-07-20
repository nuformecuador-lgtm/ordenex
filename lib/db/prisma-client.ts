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

// Tamano maximo del pool de `pg` POR INSTANCIA de funcion. El default de `pg`
// es 10, que en Vercel se multiplica por cada instancia concurrente y agota el
// pooler de Supabase ("too many connections"). Con Fluid Compute una instancia
// atiende varias requests a la vez, asi que 1 serializaria el acceso a la base;
// 3 es el punto medio. Override por entorno con `DB_POOL_MAX` si hace falta.
const DEFAULT_POOL_MAX = 3;

function resolvePoolMax(): number {
  const raw = process.env.DB_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POOL_MAX;
}

export function getPrismaClient(): PrismaClient {
  if (!globalThis.__prisma__) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: resolvePoolMax(),
      // Suelta conexiones ociosas rapido: cuando Vercel escala hacia abajo, una
      // instancia dormida no debe seguir ocupando slots del pooler.
      idleTimeoutMillis: 10_000,
      // Falla rapido en vez de dejar la request colgada si el pooler esta saturado.
      connectionTimeoutMillis: 10_000,
    });
    globalThis.__prisma__ = new PrismaClient({ adapter });
  }
  return globalThis.__prisma__;
}
