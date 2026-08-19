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

/* -------------------------------------------------------------------------- */
/* Log de consultas SQL                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cuánto se imprime de cada consulta.
 *
 * - `off`    — nada (por defecto).
 * - `sql`    — la sentencia y su duración.
 * - `params` — además, los PARÁMETROS con los que se ejecutó.
 */
export type ModoLogQueries = "off" | "sql" | "params";

/** Variable de entorno que lo enciende. */
export const ENV_LOG_QUERIES = "PRISMA_LOG_QUERIES";

/**
 * Decide el modo a partir del entorno. Función PURA (recibe el entorno) para poder
 * comprobarla sin abrir una conexión.
 *
 * DOS candados, y ninguno es paranoia de más:
 *
 * 1. **En producción SIEMPRE `off`**, aunque la variable esté puesta. Un log por consulta
 *    en Vercel es una factura de ingesta de logs y un ruido que entierra los errores de
 *    verdad; encenderlo ahí tiene que costar un despliegue, no una variable de entorno
 *    cambiada a las tres de la mañana.
 * 2. **Los parámetros son un nivel APARTE**, no un extra del interruptor general. La
 *    sentencia es una plantilla y no dice nada de nadie; los parámetros llevan datos
 *    reales —un `where` del buscador arrastra teléfono y nombre del destinatario, que es
 *    justo el PII que `PRISMA_OMIT` se cuida de no traer en las filas—. Quien los quiera
 *    tiene que pedirlos por su nombre.
 */
export function modoLogQueries(env: NodeJS.ProcessEnv = process.env): ModoLogQueries {
  if (env.NODE_ENV === "production") return "off";
  const raw = env[ENV_LOG_QUERIES]?.trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") return "off";
  return raw === "params" ? "params" : "sql";
}

/** Cliente con el log de consultas ya enchufado, si el entorno lo pide. */
function construirCliente(adapter: PrismaPg): PrismaClient {
  const modo = modoLogQueries();
  if (modo === "off") {
    return new PrismaClient({ adapter, omit: PRISMA_OMIT }) as unknown as PrismaClient;
  }

  const cliente = new PrismaClient({
    adapter,
    omit: PRISMA_OMIT,
    // `emit: "event"` y no `"stdout"`: así el formato lo decide esta función —incluido
    // el recorte de los parámetros— en vez de imprimirlo Prisma por su cuenta.
    log: [{ emit: "event", level: "query" }],
  });

  cliente.$on("query", (evento) => {
    const linea = `[prisma] ${evento.duration}ms  ${evento.query}`;
    console.debug(modo === "params" ? `${linea}\n  params: ${evento.params}` : linea);
  });

  return cliente as unknown as PrismaClient;
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
    // El `omit` cambia el TIPO del cliente (`PrismaClient<{ omit: … }>`): sus payloads de
    // `orden` dejan de tener `busquedaTexto`, y ese tipo NO es asignable al `PrismaClient`
    // ancho contra el que estan tipados los ~25 repositorios del repo. Ensanchar el tipo en
    // ESTE unico punto es deliberado y es el mal menor: la alternativa es propagar el
    // parametro generico por toda la capa de datos para expresar la ausencia de un campo
    // que nadie lee. La garantia que importa (R28) es de EJECUCION —la columna no viaja en
    // ninguna fila— y la demuestra un test contra Postgres real, no el compilador.
    globalThis.__prisma__ = construirCliente(adapter);
  }
  return globalThis.__prisma__;
}
