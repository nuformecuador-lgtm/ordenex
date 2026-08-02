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

/**
 * Feature 169 (design §2.6, R28) — columnas que NINGUNA lectura debe traer nunca.
 *
 * `orden.busqueda_texto` es la columna GENERADA del buscador: duplica dentro de la misma
 * fila el nombre y el telefono del destinatario (PII) y no la consume nadie. Sin este
 * `omit`, un `findMany` sin `select` la traeria en cada fila:
 *   (i) la descarga del dataset completo (feature 151) materializa hasta 5000 ordenes por
 *       archivo — cientos de KB de transferencia por descarga a cambio de nada;
 *   (ii) bastaria con que un DTO futuro hiciera `...orden` para filtrarla al cliente.
 * Con el `omit`, lo segundo es imposible POR CONSTRUCCION, no por disciplina.
 *
 * NO afecta al `where`: se puede seguir filtrando por la columna (que es justo para lo
 * unico que existe). Se exporta para que el test pueda comprobar la garantia sin abrir
 * una conexion.
 */
export const PRISMA_OMIT = { orden: { busquedaTexto: true } } as const;

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
    // El `omit` cambia el TIPO del cliente (`PrismaClient<{ omit: … }>`): sus payloads de
    // `orden` dejan de tener `busquedaTexto`, y ese tipo NO es asignable al `PrismaClient`
    // ancho contra el que estan tipados los ~25 repositorios del repo. Ensanchar el tipo en
    // ESTE unico punto es deliberado y es el mal menor: la alternativa es propagar el
    // parametro generico por toda la capa de datos para expresar la ausencia de un campo
    // que nadie lee. La garantia que importa (R28) es de EJECUCION —la columna no viaja en
    // ninguna fila— y la demuestra un test contra Postgres real, no el compilador.
    globalThis.__prisma__ = new PrismaClient({
      adapter,
      omit: PRISMA_OMIT,
    }) as unknown as PrismaClient;
  }
  return globalThis.__prisma__;
}
