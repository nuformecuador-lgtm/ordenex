// La COHORTE DE CARGA: de las ordenes que entraron un dia, que fue de ellas y en cuanto tiempo.
//
// ─── ⚠ LA VENTANA CAE SOBRE LA CARGA, NUNCA SOBRE EL CIERRE ─────────────────────────────
//
// Es EL error que esta consulta existe para no cometer, y no se ve mirando la pantalla. En este
// repo ya hay una consulta casi identica —`CicloVidaRepository`, que tambien mide de
// `orden.created_at` a la ultima transicion terminal— y su ventana esta en el sitio CONTRARIO:
// alli acota la TRANSICION (`condicionDeVentanaTerminal`, sobre `h."created_at"`) porque
// contesta «de lo que CERRO esta semana, cuanto tardo», y por eso una orden creada en enero y
// cerrada en agosto cuenta alli en AGOSTO.
//
// Una cohorte es exactamente lo contrario: esa orden cuenta en ENERO, que es cuando entro el
// lote. Aqui la ventana cae sobre `o."created_at"` y el CTE `cierre` NO lleva ninguna condicion
// temporal (R12) — la orden se sigue hasta su desenlace, caiga donde caiga.
//
// POR QUE ES PELIGROSO Y NO SOLO INCORRECTO: copiar `condicionDeVentanaTerminal` aqui no rompe
// nada. No hay excepcion, no hay fila de mas, no hay tipo que no compile. La tabla sale con
// dias plausibles, cohortes plausibles y porcentajes plausibles — y equivocados: estaria
// contestando «que cerro esta semana» con el rotulo «que se cargo esta semana». Su contencion
// es `tests/integration/db/cohorte-carga-ventana.int.test.ts`, contra Postgres real.
//
// ─── LA FRONTERA DEL DIA: NI UNA ZONA HORARIA EN ESTE SQL ────────────────────────────────
//
// Regla heredada de la 180 y NO negociable: no hay `AT TIME ZONE`, no hay `America/Costa_Rica`,
// no hay `date_trunc` con zona y no hay `interval '6 hours'`. El dia CR entra como el fragmento
// `DIA_CR` que ya vive en `ConteoCargadasPorDiaRepository` —se IMPORTA, no se copia—, y ese
// fragmento manda el desfase como PARAMETRO derivado de `lib/utils/fecha-cr.ts`.
//
// Un piso mas abajo, la misma trampa: las COTAS de la ventana son las que trae `resolverRango`
// (`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, todo borde en `...T06:00:00.000Z`).
// `startOfDayCR` es la medianoche UTC de la fecha CR: correcta contra columnas `@db.Date` y un
// error de SEIS HORAS contra un `timestamp` como `orden.created_at` —la ventana real seria
// 18:00-18:00 hora CR—. Tampoco se ve a ojo: los conteos siguen siendo enteros razonables, solo
// que unos cuantos estan en la cohorte de al lado.
//
// ─── COSTE DECLARADO ────────────────────────────────────────────────────────────────────
//
// Es la CUARTA escritura del mismo `where`. Lo que se hace al respecto es lo de las otras tres:
// el recorte comun se REUSA de verdad —`condicionesSinFecha` se importa, no se reescribe—, y lo
// propio (la ventana, siempre presente) se construye en `condicionesDeCohorte`, funcion PURA y
// exportada para inspeccionarla sin base de datos. La contencion contra la divergencia es
// `cohorte-carga-equivalencia.int.test.ts`: dia a dia, la suma de los cubos tiene que ser el
// conteo de la serie hermana sobre el MISMO filtro.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  condicionesSinFecha,
  DIA_CR,
} from "@/lib/repositories/ConteoCargadasPorDiaRepository";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import type { ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import type {
  CohorteCuboCrudo,
  ICohorteCargaRepository,
} from "@/lib/interfaces/repositories/ICohorteCargaRepository";
import type { CohorteDesenlace } from "@/lib/types/cohorte-carga";

/** Cliente MINIMO consumido (patron del resto de la vertical): una sola consulta cruda.
 *  `$queryRawUnsafe` NO esta y no puede estar: el tipo del cliente es la primera barrera
 *  contra la interpolacion de strings. */
type CohorteCargaPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * Los `value` TERMINALES del catalogo, como lista SQL.
 *
 * Se IMPORTAN del dominio y no se reescriben: misma constante y MISMA LINEA que
 * `AnaliticaOperativaVivaRepository` y `CicloVidaRepository`, que rinden esa lista a SQL asi
 * desde antes. No se importa la de ninguno de los dos porque las dos son privadas de su modulo
 * y cruzar hacia alli meteria este archivo en censos de otra vertical; lo que impide que nazca
 * una TERCERA lista no es el parecido sino el censo de
 * `tests/unit/analytics/cohorte-terminales.guardia.test.ts`, que prohibe escribir aqui los
 * `value` a mano. Un cuarto estado terminal entra solo en las tres consultas.
 */
const TERMINALES = Prisma.join([...ESTADOS_TERMINALES]);

/** El cubo de las ordenes que NO han llegado a ningun estado terminal. */
const CUBO_VIVA: CohorteDesenlace = "viva";

interface FilaCohorte {
  readonly dia: string;
  readonly desenlace: CohorteDesenlace;
  readonly n: number;
  readonly seg: string | number | null;
}

/**
 * El `where` de la cohorte: el recorte comun de la vertical MAS su ventana, que aqui esta
 * SIEMPRE. Funcion PURA y exportada: es donde vive la semantica y se comprueba sin base de
 * datos.
 *
 * ⚠ LA VENTANA ES OBLIGATORIA, y por eso no hay rama «sin rango». Las otras siete lecturas
 * aceptan `rango: null` («sin filtrar significa TODO», decision del 2026-08-18); esta no puede:
 * una tabla con una fila por cada dia que alguna vez tuvo carga crece sin techo y deja de ser
 * una herramienta. El borde responde `sin_rango` ANTES de llegar hasta aqui, asi que un `null`
 * en este punto es un fallo de programacion y se dice en voz alta: dejar caer la condicion en
 * silencio volcaria la historia entera.
 *
 * La ventana cae sobre `o."created_at"` —la fecha de CARGA, la misma por la que se agrupa— y es
 * SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR del dia
 * SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` meteria el dia siguiente
 * entero.
 */
export function condicionesDeCohorte(consulta: ConsultaConteoEntregas): Prisma.Sql[] {
  const { rango } = consulta;
  if (rango === null) {
    throw new Error(
      "CohorteCargaRepository: la cohorte de carga EXIGE rango y la consulta llego sin el. " +
        "El borde debe responder `sin_rango` antes de consultar.",
    );
  }

  return [
    // `condicionesSinFecha` ya pone el ALCANCE como PRIMERA condicion (frontera multi-tenant)
    // y detras el soft delete y las cinco facetas de recorte. No se reescribe aqui: sin
    // policies RLS debajo, ese fragmento es la unica separacion entre inquilinos, y una segunda
    // copia es una copia que puede quedarse atras.
    //
    // De sus seis dimensiones, la de MENSAJERO queda fuera —alli no se escribe ningun `EXISTS`
    // sobre `gestion_orden`— y aqui eso es lo correcto y no una omision: una orden no la carga
    // un mensajero. Consecuencia declarada: con un mensajero seleccionado, esta seccion NO se
    // recorta y otras si, asi que la pantalla tiene que decirlo.
    ...condicionesSinFecha(consulta),
    Prisma.sql`o."created_at" >= ${rango.desde}`,
    Prisma.sql`o."created_at" <  ${rango.hasta}`,
  ];
}

export class CohorteCargaRepository implements ICohorteCargaRepository {
  constructor(private readonly prisma: CohorteCargaPrismaClient) {}

  async contarCohortes(consulta: ConsultaConteoEntregas): Promise<readonly CohorteCuboCrudo[]> {
    const where = Prisma.join(condicionesDeCohorte(consulta), " AND ");

    // UNA sola consulta por lectura (R38), nunca una por dia del rango.
    //
    // Lo que compra cada pieza, y por que no se escribe de otra manera:
    //
    //  - `cohorte` PRIMERO, y el historial JOINeado CONTRA ella. No se deduplica el historial
    //    entero para tirar casi todo: `cierre` solo visita las ordenes ya recortadas, y por eso
    //    el indice `(orden_id, created_at)` es aplicable.
    //  - `DISTINCT ON ... ORDER BY orden_id, created_at DESC, id DESC` — la ULTIMA transicion
    //    terminal (R9), no la primera: una orden puede entrar a terminal, deshacerse y volver a
    //    entrar. El desempate por `id` no es defensivo: sin el, dos filas con el mismo
    //    `created_at` harian el resultado no determinista entre ejecuciones.
    //  - `LEFT JOIN` + `COALESCE(..., 'viva')` — el cubo de las vivas sale del propio `LEFT`, no
    //    de una segunda consulta ni de una resta en memoria. Por construccion los cubos SUMAN
    //    exactamente las cargadas del dia (R11).
    //  - `SUM(...)` SIN `COALESCE` — en el grupo de las vivas todos los sumandos son `NULL`, asi
    //    que `SUM` devuelve `NULL`: el numerador queda AUSENTE y no cero (R16), sin escribir un
    //    `CASE`. Cero segundos seria una afirmacion; aqui no hay reloj que parar.
    //  - `ORDER BY 1 DESC` es CONTRATO (R6): la cohorte mas reciente primero, que es lo que se
    //    viene a mirar. Como la clave es `YYYY-MM-DD`, el orden lexicografico ES el cronologico.
    //    Diverge a proposito de la serie hermana (ascendente, porque pinta un eje temporal) y
    //    se decide AQUI, en un solo sitio: la pantalla no reordena.
    const filas = await this.prisma.$queryRaw<FilaCohorte[]>`
      WITH cohorte AS (
        SELECT o."id"         AS orden_id,
               o."created_at" AS cargada_at,
               ${DIA_CR}      AS dia
        FROM "orden" o
        WHERE ${where}
      ),
      cierre AS (
        SELECT DISTINCT ON (h."orden_id")
               h."orden_id"   AS orden_id,
               h."created_at" AS cerrado_at,
               s."value"      AS desenlace
        FROM "orden_historial_estado" h
        JOIN "cohorte" c      ON c.orden_id = h."orden_id"
        JOIN "order_status" s ON s."id" = h."estatus_destino_id"
        WHERE s."value" IN (${TERMINALES})
        ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC
      )
      SELECT c.dia                                AS dia,
             COALESCE(x.desenlace, ${CUBO_VIVA})  AS desenlace,
             COUNT(*)::int                        AS n,
             SUM(EXTRACT(EPOCH FROM (x.cerrado_at - c.cargada_at))::bigint)::bigint AS seg
      FROM cohorte c
      LEFT JOIN cierre x ON x.orden_id = c.orden_id
      GROUP BY 1, 2
      ORDER BY 1 DESC, 2 ASC`;

    // `SUM(...)::bigint` llega como STRING por el driver, y como `null` cuando todos los
    // sumandos lo eran. El `null` se CONSERVA —no se colapsa a 0— porque es la diferencia
    // entre «cerraron al instante» y «no hay cierre que medir».
    return filas.map((f) => ({
      fecha: f.dia,
      desenlace: f.desenlace,
      n: Number(f.n),
      segundosAcum: f.seg === null ? null : Number(f.seg),
    }));
  }
}
