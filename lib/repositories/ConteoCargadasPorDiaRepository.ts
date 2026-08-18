// La serie de ORDENES CARGADAS POR DIA: una fila por dia calendario CR con al menos una orden.
//
// ─── POR QUE ESTE NO PUEDE SER UN `groupBy` DE PRISMA ───────────────────────────────────
//
// `orden.created_at` es un INSTANTE (`timestamp`, no `@db.Date`), y `groupBy` de Prisma solo
// agrupa por COLUMNAS, nunca por expresiones: no hay forma de decirle «agrupa por el dia
// calendario de Costa Rica de esta columna». Es el mismo callejon que la feature 180 documento
// para la fecha de los movimientos de caja, con la misma alternativa descartada por el mismo
// motivo: una columna generada `fecha_cr date` no es declarable en el datamodel sin que el
// cliente la meta en los `INSERT` y rompa toda escritura de `orden`.
//
// (El nombre de aquel repositorio NO se escribe aqui a proposito: `financiera-fuente.guardia`
// descubre «archivos de la 127» por huella de texto, y mencionarlo metia este archivo —que
// consulta `orden`— en un censo que solo admite las cinco tablas de dinero.)
//
// ─── LA FRONTERA DEL DIA: UNA SOLA DEFINICION, Y VIAJA COMO PARAMETRO ───────────────────
//
// Regla heredada de la 180 y NO negociable: en este SQL no hay ni una zona horaria. No hay
// `AT TIME ZONE`, no hay `America/Costa_Rica`, no hay `date_trunc` con zona y no hay
// `interval '6 hours'`. Cualquiera de esas seria una SEGUNDA definicion del dia operativo
// fuera del alcance de `lib/utils/fecha-cr.ts` — el off-by-one de seis horas del que avisa
// `lib/analytics/ranges.ts`.
//
// Lo que si hay es un DESFASE en segundos que se DERIVA de `fecha-cr.ts` en TypeScript y entra
// como PARAMETRO (`$n`). No es una constante escondida en el SQL: es la misma y unica
// definicion del dia CR, escrita donde vive, cruzando la frontera como dato. Si algun dia
// Costa Rica adoptase horario de verano, este archivo no se toca.
//
// ⚠ Y AUN ASI ESTA CONSULTA NO PODIA SALIR DE `trocear()` (`lib/analytics/cubo-temporal.ts`),
// que es como se resolvio la 180: aquel calcula las fronteras de cada cubo en TypeScript y las
// manda como array, lo que exige conocer la ventana. Aqui la ventana puede ser `null` —«sin
// filtro de fecha», decision del 2026-08-18—, y entonces no existe la lista de dias que
// mandar: el conjunto de dias es justo lo que la consulta viene a descubrir. Por eso el
// agrupamiento se hace en la base y el desfase viaja como escalar.
//
// ─── COSTE DECLARADO ────────────────────────────────────────────────────────────────────
//
// Esta es la TERCERA escritura del mismo `where` (las otras dos: la de objetos Prisma en
// `ConteoEntregasRepository` y la de SQL en `ConteoPorStatusRepository`), y pueden DIVERGIR.
// Lo que se hace al respecto es lo mismo que alli: el recorte por rol se REUSA de verdad
// —`condicionDeAlcance` se importa, no se reescribe—, las condiciones se construyen en
// `condicionesDeCargadas`, funcion PURA y exportada para inspeccionarla sin base de datos, y
// el alcance es SIEMPRE la primera condicion.
//
// La condicion de FECHA, en cambio, es distinta a proposito y no debe converger nunca: alli la
// ventana cae sobre `COALESCE(ultima gestion vigente, o.created_at)` («cuando paso algo con la
// orden») y aqui sobre `o.created_at` a secas («cuando entro la orden»). Filtrar por la fecha
// efectiva y agrupar por la de carga daria una serie con dias fuera del rango pedido.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { condicionDeAlcance } from "@/lib/repositories/ConteoPorStatusRepository";
import { inicioDelDiaCREnUtc } from "@/lib/utils/fecha-cr";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type { IConteoCargadasPorDiaRepository } from "@/lib/interfaces/repositories/IConteoCargadasPorDiaRepository";
import type { ConteoDeDia } from "@/lib/types/conteo-cargadas";

/** Cliente MINIMO consumido (patron `ConteoPorStatusRepository`): una sola consulta cruda.
 *  `$queryRawUnsafe` NO esta y no puede estar: el tipo del cliente es la primera barrera
 *  contra la interpolacion de strings. */
type ConteoCargadasPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Segundos que hay que RESTAR a un instante UTC para leer el reloj de pared de Costa Rica.
 *
 * DERIVADO, no escrito: `inicioDelDiaCREnUtc("2000-01-01")` es, por definicion, el instante en
 * que empieza ese dia CR; la distancia a la medianoche UTC de la MISMA fecha calendario es el
 * desfase. Misma tecnica que `UN_DIA_MS` en `ranges.ts` y `cubo-temporal.ts`, y por la misma
 * razon: que este archivo no contenga ninguna constante temporal propia.
 */
const FECHA_ANCLA = "2000-01-01";
const DESFASE_CR_SEGUNDOS =
  (inicioDelDiaCREnUtc(FECHA_ANCLA).getTime() - Date.parse(`${FECHA_ANCLA}T00:00:00.000Z`)) / 1000;

/**
 * El dia calendario CR de `orden.created_at`, como texto `YYYY-MM-DD`.
 *
 * DOS DECISIONES QUE NO SON DE ESTILO:
 *
 * 1. **El desfase entra como parametro** con cast explicito a `double precision`, multiplicado
 *    por `interval '1 second'`, que es una UNIDAD y no un offset. Sin el cast, Postgres no
 *    puede inferir el tipo del parametro dentro de la multiplicacion y responde `42P18`.
 *    `o."created_at"` es `timestamp` SIN zona y guarda el reloj de pared UTC, asi que restarle
 *    el desfase da el reloj de pared CR y `::date` su fecha de calendario.
 *
 * 2. **Sale como TEXTO (`to_char`), no como `date`.** Una columna `date` vuelve del driver como
 *    un `Date` de JavaScript, y a partir de ahi cada consumidor tendria que decidir en que huso
 *    lo lee — que es exactamente como se reintroduce el off-by-one de seis horas. El contrato
 *    (`ConteoDeDia.fecha`) es una fecha CALENDARIO, y una cadena `YYYY-MM-DD` no admite dos
 *    lecturas.
 */
const DIA_CR = Prisma.sql`to_char(
  (o."created_at" - ${DESFASE_CR_SEGUNDOS}::double precision * interval '1 second')::date,
  'YYYY-MM-DD'
)`;

interface FilaCargadas {
  readonly dia: string;
  readonly n: number;
}

/** Lista de ids como parametros, nunca interpolada: cada uno entra como `$n`. */
function comoParametros(ids: readonly string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}`));
}

/** `col IN (...)` solo si la dimension se filtro. `null` = sin recorte por esa faceta. */
function enLista(columna: Prisma.Sql, ids: readonly string[] | undefined): Prisma.Sql | null {
  if (ids === undefined || ids.length === 0) return null;
  return Prisma.sql`${columna} IN (${comoParametros(ids)})`;
}

/**
 * El recorte de la consulta SIN su ventana temporal. Funcion PURA y exportada: es donde vive la
 * semantica y se comprueba sin base de datos.
 *
 * El alcance, el soft delete y las cinco facetas de recorte son los MISMOS que los de las otras
 * lecturas de la vertical —mismo filtro, misma barra, cifras comparables— y el orden tampoco es
 * cosmetico: el alcance va PRIMERO para que se lea de un vistazo que la consulta esta recortada
 * por rol antes que por nada que haya pedido el cliente.
 *
 * LA FECHA SE QUEDA FUERA A PROPOSITO, y por eso esta funcion existe separada: las dos lecturas
 * que la usan ponen ventanas DISTINTAS sobre la misma columna —esta, la que pida el filtro; la
 * del contador de hoy (`ConteoHoyGestionRepository`), el dia CR en curso y solo ese— y compartir
 * el resto del `where` es lo que impide que se separen en todo lo demas.
 */
export function condicionesSinFecha(consulta: ConsultaConteoEntregas): Prisma.Sql[] {
  const { filtro, alcance } = consulta;

  const condiciones: Prisma.Sql[] = [
    // ⚠ FRONTERA MULTI-TENANT. Se REUSA `condicionDeAlcance` en vez de reescribirla: sin
    // policies RLS debajo, esta condicion es la unica separacion entre inquilinos, y una
    // segunda copia es una copia que puede quedarse atras.
    condicionDeAlcance(alcance),
    // Soft delete: una orden borrada no cuenta en ningun dia.
    Prisma.sql`o."deleted_at" IS NULL`,
  ];

  const facetas: [Prisma.Sql, readonly string[] | undefined][] = [
    [Prisma.sql`o."zona_id"`, filtro.zona_id],
    [Prisma.sql`o."provincia_id"`, filtro.provincia_id],
    [Prisma.sql`o."canton_id"`, filtro.canton_id],
    [Prisma.sql`o."distrito_id"`, filtro.distrito_id],
    [Prisma.sql`o."tienda_id"`, filtro.tienda_id],
  ];
  for (const [columna, ids] of facetas) {
    const fragmento = enLista(columna, ids);
    if (fragmento) condiciones.push(fragmento);
  }

  // ⚠ MENSAJERO: ESTA LECTURA NO ADMITE ESA FACETA (decision humana del 2026-08-18), y por eso
  // AQUI NO HAY NINGUN `EXISTS` sobre `gestion_orden` — es la unica de las seis dimensiones del
  // filtro que este `where` deja fuera, y la ausencia es deliberada.
  //
  // POR QUE: la pregunta es «cuantas ordenes ENTRARON cada dia», y una orden no la carga un
  // mensajero. Las otras dos lecturas si aplican la faceta porque su bucket sale de la GESTION
  // —«quien la gestiono» es parte de lo que preguntan—; aqui recortar por mensajero contestaria
  // otra cosa: «de las cargadas ese dia, cuantas acabo tocando este mensajero», que no es una
  // curva de carga y se leeria como si lo fuera.
  //
  // CONSECUENCIA QUE HAY QUE SABER, porque la barra de filtros es UNA sola: con un mensajero
  // seleccionado, esta serie NO se recorta y las otras dos SI. La pantalla tiene que decirlo
  // —el grafico de carga ignora ese filtro—; si no lo dice, el usuario lee tres graficos y
  // supone que los tres responden a lo mismo. Se prefirio esto a rechazar la consulta: un
  // `validation_error` dejaria la pantalla entera rota en cuanto alguien tocase el selector.
  //
  // `filtro.mensajero_id` SI sigue entrando en la clave de cache (`claveConPrefijo`, componente
  // `x=`). Es redundante —dos consultas que solo difieren en esa faceta dan el mismo resultado y
  // ocupan dos entradas— y se acepta: sacarlo de la clave obligaria a una clave propia para esta
  // lectura, y una clave que ignora un componente del filtro es la clase de atajo que un dia
  // sirve datos de un recorte en otro.

  return condiciones;
}

/**
 * El `where` completo de la serie: el recorte comun MAS su ventana. Pura y exportada por el
 * mismo motivo que la anterior.
 */
export function condicionesDeCargadas(consulta: ConsultaConteoEntregas): Prisma.Sql[] {
  const { rango } = consulta;
  const condiciones = condicionesSinFecha(consulta);

  // La ventana cae sobre `o."created_at"` — la fecha de CARGA, la misma por la que se agrupa.
  // Es la unica condicion que NO coincide con la de las otras dos lecturas, y es deliberado
  // (ver la cabecera): con la fecha efectiva aqui, la serie tendria dias fuera del rango.
  //
  // SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR del dia
  // SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` meteria el dia
  // siguiente entero.
  //
  // SIN rango no se anade ninguna condicion de fecha: la pantalla no arranca con ventana
  // puesta, y «sin filtrar» tiene que contar todas las ordenes y no las de una semana.
  if (rango !== null) {
    condiciones.push(
      Prisma.sql`o."created_at" >= ${rango.desde}`,
      Prisma.sql`o."created_at" <  ${rango.hasta}`,
    );
  }

  return condiciones;
}

export class ConteoCargadasPorDiaRepository implements IConteoCargadasPorDiaRepository {
  constructor(private readonly prisma: ConteoCargadasPrismaClient) {}

  async contarCargadasPorDia(consulta: ConsultaConteoEntregas): Promise<readonly ConteoDeDia[]> {
    const where = Prisma.join(condicionesDeCargadas(consulta), " AND ");

    // Ni un JOIN: el dia de carga esta en la propia fila de `orden`, asi que esta consulta no
    // necesita el `LEFT JOIN LATERAL` sobre la ultima gestion vigente que si necesitan las
    // otras dos. La unica excepcion es el `EXISTS` del filtro por mensajero, y solo cuando ese
    // filtro viene puesto.
    //
    // `ORDER BY 1 ASC` es CONTRATO, no presentacion: `ConteoCargadasPorDiaDTO.porDia` promete
    // orden cronologico ascendente, y ordenar aqui —donde ya estan las filas— evita que cada
    // consumidor lo rehaga. Como la clave es `YYYY-MM-DD`, el orden lexicografico ES el
    // cronologico.
    const filas = await this.prisma.$queryRaw<FilaCargadas[]>`
      SELECT ${DIA_CR}     AS dia,
             COUNT(*)::int AS n
      FROM "orden" o
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC`;

    // `GROUP BY` no emite filas para los dias vacios, asi que un dia sin cargas no viene — que
    // es exactamente lo pedido (ver `ConteoCargadasPorDiaDTO`: el hueco significa cero). No hay
    // nada que filtrar aqui.
    return filas.map((f) => ({ fecha: f.dia, conteo: Number(f.n) }));
  }
}
