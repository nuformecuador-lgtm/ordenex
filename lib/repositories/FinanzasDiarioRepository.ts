// El libro de la caja SUMADO POR DIA calendario de Costa Rica.
//
// ─── POR QUE SQL CRUDO, otra vez y por el mismo motivo de siempre ───────────────────────
//
// `fecha_movimiento` es un INSTANTE (`timestamp`, no `@db.Date`) y `groupBy` de Prisma solo
// agrupa por COLUMNAS, nunca por expresiones: no hay forma de pedirle «agrupa por el dia
// calendario de Costa Rica de esta columna». La alternativa —una columna generada `fecha_cr`—
// no es declarable en el datamodel sin que el cliente la meta en los `INSERT` y rompa toda
// escritura del libro. Es el mismo callejon que ya documento la feature 180 para esta misma
// tabla, con la misma salida.
//
// UNA SOLA TABLA, la de siempre: `wallet_movimiento`. Ni un join. Parametrizado con
// `Prisma.sql`; `$queryRawUnsafe` no esta en el tipo del cliente y no puede estar.
//
// ─── LA FRONTERA DEL DIA: UNA SOLA DEFINICION, Y VIAJA COMO PARAMETRO ───────────────────
//
// En este SQL no hay ni una zona horaria: ni `AT TIME ZONE`, ni `America/Costa_Rica`, ni
// `date_trunc` con zona, ni `interval '6 hours'`. Cualquiera de esas seria una SEGUNDA
// definicion del dia operativo fuera del alcance de `lib/utils/fecha-cr.ts`. El desfase se
// DERIVA alli y entra como parametro, igual que en `ConteoCargadasPorDiaRepository` — y por eso
// los dias de esta serie y los de aquella empiezan y acaban en el mismo instante.
//
// ─── NO SE CLASIFICA NADA AQUI ──────────────────────────────────────────────────────────
//
// Sale desglosado por `(dia, categoria, tipo)` y la particion propio/terceros la hace
// `derivarFinanzasDiarias` con `NATURALEZA_POR_CATEGORIA`. Decidir aqui que es ganancia
// escribiria esa regla de negocio por segunda vez, dentro de una cadena de SQL donde nadie la
// buscaria.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";
import type {
  AgregadoDiarioCajaRow,
  IFinanzasDiarioRepository,
} from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";
import type { WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";

/** Cliente MINIMO consumido: una sola consulta cruda. */
type FinanzasDiarioPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Segundos que hay que RESTAR a un instante UTC para leer el reloj de pared de Costa Rica.
 * DERIVADO de `fecha-cr.ts`, no escrito: este archivo no contiene ninguna constante temporal
 * propia, asi que si Costa Rica adoptara horario de verano no habria que tocarlo.
 */
const FECHA_ANCLA = "2000-01-01";
const DESFASE_CR_SEGUNDOS =
  (inicioDelDiaCREnUtc(FECHA_ANCLA).getTime() - Date.parse(`${FECHA_ANCLA}T00:00:00.000Z`)) / 1000;

/**
 * El dia calendario CR de `fecha_movimiento`, como TEXTO `YYYY-MM-DD`.
 *
 * Texto y no `date` porque una columna `date` vuelve del driver como un `Date` de JavaScript y
 * cada consumidor tendria que volver a elegir huso para leerla — que es como se reintroduce el
 * off-by-one. El cast del desfase a `double precision` no es decorativo: sin el, Postgres no
 * puede inferir el tipo del parametro dentro de la multiplicacion y responde `42P18`.
 */
const DIA_CR = Prisma.sql`to_char(
  (m."fecha_movimiento" - ${DESFASE_CR_SEGUNDOS}::double precision * interval '1 second')::date,
  'YYYY-MM-DD'
)`;

/**
 * La fila cruda tal como la entrega `$queryRaw`. `SUM(monto)` es `numeric` y llega como
 * `Prisma.Decimal`: tiparlo explicitamente es lo unico que impide que el dinero se escape a
 * `number` sin que nadie lo note — `$queryRaw<T>` no valida nada.
 */
interface FilaCruda {
  readonly fecha: string;
  readonly categoria: WalletMovimientoCategoria;
  readonly tipo: WalletMovimientoTipo;
  /** `SUM(numeric)` llega como `Prisma.Decimal`; se admite tambien `string` porque asi es como
   *  lo entrega un doble de test —y algun driver— y `new Prisma.Decimal` acepta las dos sin
   *  pasar en ningun momento por `number`. */
  readonly total: Prisma.Decimal | string | null;
}

export class FinanzasDiarioRepository implements IFinanzasDiarioRepository {
  constructor(private readonly prisma: FinanzasDiarioPrismaClient) {}

  async sumarPorDia(desde: Date, hasta: Date): Promise<readonly AgregadoDiarioCajaRow[]> {
    // ⚠ EL CAST ES `::timestamp`, NO `::timestamptz`, y esto se midio contra Postgres en la
    // feature 180: `fecha_movimiento` es `timestamp` SIN zona y guarda el reloj de pared UTC.
    // Con `::timestamptz`, Postgres interpretaria el texto en el huso de la SESION —el del
    // proceso de Node— y desplazaria toda frontera cinco o seis horas sin que nada fallara.
    //
    // Ventana SEMIABIERTA `[desde, hasta)`: el borde superior es la 00:00 CR del dia siguiente
    // al ultimo, asi que un `<=` metería ese dia entero.
    //
    // La tabla es APPEND-ONLY y sin soft delete (`db/schema.prisma`), asi que aqui no hay
    // ningun `deleted_at IS NULL` que poner: no es un olvido, es que no existe esa columna.
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      SELECT ${DIA_CR}                  AS fecha,
             m."categoria"              AS categoria,
             m."tipo"                   AS tipo,
             SUM(m."monto")             AS total
      FROM "wallet_movimiento" m
      WHERE m."fecha_movimiento" >= ${desde}::timestamp
        AND m."fecha_movimiento" <  ${hasta}::timestamp
      GROUP BY 1, 2, 3
      ORDER BY 1 ASC`;

    // `toFixed(2)` y NO `Number(...)`: el importe cruza esta frontera como STRING de escala 2 y
    // no vuelve a ser un numero en ningun punto del camino hasta la pantalla.
    return filas.map((f) => ({
      fecha: f.fecha,
      categoria: f.categoria,
      tipo: f.tipo,
      total: new Prisma.Decimal(f.total ?? 0).toFixed(2),
    }));
  }
}
