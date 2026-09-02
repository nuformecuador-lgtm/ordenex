// FICHA 347 — EL SQL DEL DINERO POR PRODUCTO.
//
// ─── EL `WHERE` NO SE VUELVE A ESCRIBIR (R75), Y NO HAY NINGUNA CONDICION DE RECORTE PROPIA ──
//
// `condicionesDeConsulta` de `ConteoPorStatusRepository` se importa y se usa TAL CUAL, igual que
// hizo la 345: alcance PRIMERO, `deleted_at IS NULL`, las cinco facetas por `IN`, el `EXISTS`
// del mensajero y la ventana semiabierta. En este archivo NO se escribe ni un `tienda_id` ni un
// `zona_id` fuera de esa llamada, y eso es exactamente lo que afirma el bloque nuevo de
// `tests/unit/analytics/alcance-dinero.guardia.test.ts` leyendo esta fuente.
//
// Es la pieza que cierra el choque con la doctrina de aquella guardia: el dinero NUNCA se
// recorta con un criterio propio. O se sirve con el MISMO recorte que ya aplica el analisis de
// productos, o no se sirve.
//
// ─── EL `LEFT JOIN LATERAL` ES OBLIGATORIO AUNQUE ESTA CONSULTA NO USE EL DESENLACE ─────────
//
// `condicionesDeConsulta` referencia `u."created_at"` en la ventana de fecha. Sin el lateral con
// alias `u`, el SQL NO COMPILA. Se copia literal del de la 345 —mismo `anulada_at IS NULL`,
// mismo desempate `created_at DESC, id DESC`— para que la ventana temporal de esta consulta sea
// la MISMA que la de la fila de volumen que va a su lado (R78).
//
// ─── LA DECISION SOBRE LAS GESTIONES ANULADAS (⟨Q3⟩), Y SUS NUMEROS ──────────────────────────
//
// ⚠ LAS GESTIONES ANULADAS SE EXCLUYEN: el `JOIN` a `gestion_orden` lleva `anulada_at IS NULL`.
//
// Es una decision del humano del 2026-09-01 y DIVERGE del precedente de la 344, donde
// `CierreAporteRepository` replica el `where` del feed EXACTAMENTE —sin esa clausula— porque el
// productor del importe tampoco la lleva. Aqui se decide al reves, y con medicion:
//
//   - en produccion hay DOS gestiones anuladas con recaudo, por ₡33.564 en total;
//   - las DOS estan FUERA de cualquier cierre y de todo snapshot: ese dinero NUNCA entro en la
//     contabilidad. Mostrarlo aqui seria INVENTAR ingreso, no reflejarlo.
//
// Y ademas quita una asimetria real: la columna de desenlace de la MISMA fila ya usa solo
// gestiones vigentes (regla de la 345, que es la que pinta el `LATERAL` de arriba). Sin esta
// clausula, una gestion anulada podria aportar dinero a una fila sin aparecer en su conteo de
// entregadas — «6 entregadas» junto al recaudo de 7.
//
// Lo que esto NO es: un criterio de prudencia inventado. Es la respuesta a una pregunta que el
// spec dejo abierta y que el humano cerro con los dos numeros de arriba.
//
// ─── NINGUN INDICE NUEVO (R79) ────────────────────────────────────────────────────────────────
//
// El `where` es el de una consulta que ya corre; `gestion_orden(orden_id)`,
// `cierre_detail(orden_id)` y `cierre_detail(cierre_id, orden_id)` ya existen. Esta ficha SOLO
// LEE: ni tabla, ni columna, ni indice, ni migracion, ni RLS.

import { Prisma } from "@prisma/client";
import type { GestionResultado, PrismaClient } from "@prisma/client";

import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import type {
  FilaDineroCruda,
  IDineroProductosRepository,
  LecturaDineroProductos,
} from "@/lib/interfaces/repositories/IDineroProductosRepository";
import { condicionesDeConsulta } from "@/lib/repositories/ConteoPorStatusRepository";
import { descargaConfig } from "@/lib/config/descarga";
import { tarifaDe } from "@/lib/utils/cierre-detalle";
import type { OrdenCongelada } from "@/lib/utils/aporte-por-orden";
import { RESULTADOS_QUE_APORTAN } from "@/lib/utils/dinero-por-producto";

/** Cliente MINIMO consumido (patron `ConteoProductosRepository`): una sola consulta cruda. */
type DineroProductosPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * EL TOPE DE ORDENES DE ESTA LECTURA (R76), y por que NO es un numero nuevo.
 *
 * ⟨Q4⟩ pedia un numero y la decision del humano fue: se REUSA la configuracion de la 344, no se
 * inventa una constante. El tope con el que aquella ficha dice `limite_excedido` es
 * `descargaConfig.MAX_FILAS` (`DESCARGA_MAX_FILAS`, 5.000 por defecto), y es el mismo criterio
 * —«o van todas, o no va ninguna»— aplicado al mismo tipo de conjunto: un derivado por orden que
 * no se puede truncar sin mentir. Un segundo numero seria un segundo sitio donde ajustarlo, y el
 * dia que se moviera uno el otro se quedaria quieto.
 *
 * Referencia de tamano, MEDIDO el 2026-09-01: en produccion hay 768 ordenes; la base local
 * devuelve 18 filas de dinero sobre 67 ordenes vivas. El tope no roza el caso real ni de lejos.
 */
function topeDeOrdenes(): number {
  return descargaConfig.MAX_FILAS;
}

/** La fila tal como la devuelve Postgres. Los `numeric` llegan como `Prisma.Decimal`. */
interface FilaCruda {
  readonly orden_id: string;
  readonly tienda_id: string;
  readonly tienda_nombre: string;
  readonly producto: string;
  readonly num_guia: number | null;
  readonly num_remision: string;
  readonly destinatario: string;
  readonly gestion_id: string;
  readonly resultado: GestionResultado;
  readonly monto_recibido: Prisma.Decimal | null;
  readonly cierre_estado: string | null;
  readonly detalle_id: string | null;
  readonly monto_cobrar: Prisma.Decimal | null;
  readonly cobra_comision: boolean | null;
  readonly es_central: boolean | null;
  readonly es_zona_especial: boolean | null;
  readonly tarifa_id: string | null;
  readonly tarifa_valor_flete: Prisma.Decimal | null;
  readonly tarifa_valor_flete_gam: Prisma.Decimal | null;
  readonly tarifa_valor_flete_devuelto: Prisma.Decimal | null;
  readonly tarifa_valor_flete_devuelto_gam: Prisma.Decimal | null;
  readonly tarifa_comision_cod: Prisma.Decimal | null;
  readonly tarifa_iva_flete: Prisma.Decimal | null;
  readonly tarifa_iva_comision_cod: Prisma.Decimal | null;
  readonly tarifa_especial: Prisma.Decimal | null;
  readonly tarifa_especial_devuelta: Prisma.Decimal | null;
}

/** Los resultados que aportan, como parametros. DERIVADOS del criterio (R24), nunca escritos. */
function resultadosQueAportan(): Prisma.Sql {
  return Prisma.join(RESULTADOS_QUE_APORTAN.map((r) => Prisma.sql`${r}`));
}

/**
 * Las ENTRADAS CONGELADAS de esa orden en ese cierre, o `null` si no hay fila de snapshot.
 *
 * `tarifaDe` es la MISMA reconstruccion que usan los dos feeds del cierre y el detalle de la
 * 344: `null` cuando `tarifa_id IS NULL` (gap R9 preservado, esa orden no deriva nada).
 * Money-safe: `Decimal -> STRING escala 2`, nunca `number`.
 */
function congeladaDe(f: FilaCruda): OrdenCongelada | null {
  if (f.detalle_id === null) return null;
  return {
    esCentral: f.es_central === true,
    esZonaEspecial: f.es_zona_especial === true,
    montoCobrar: f.monto_cobrar === null ? null : f.monto_cobrar.toFixed(2),
    cobraComision: f.cobra_comision === true,
    tarifa: tarifaDe({
      tarifaId: f.tarifa_id,
      tarifaValorFlete: f.tarifa_valor_flete,
      tarifaValorFleteGam: f.tarifa_valor_flete_gam,
      tarifaValorFleteDevuelto: f.tarifa_valor_flete_devuelto,
      tarifaValorFleteDevueltoGam: f.tarifa_valor_flete_devuelto_gam,
      tarifaComisionCod: f.tarifa_comision_cod,
      tarifaIvaFlete: f.tarifa_iva_flete,
      tarifaIvaComisionCod: f.tarifa_iva_comision_cod,
      tarifaEspecial: f.tarifa_especial,
      tarifaEspecialDevuelta: f.tarifa_especial_devuelta,
    }),
  };
}

export class DineroProductosRepository implements IDineroProductosRepository {
  constructor(private readonly prisma: DineroProductosPrismaClient) {}

  async leerDineroPorOrden(consulta: ConsultaProductos): Promise<LecturaDineroProductos> {
    const where = Prisma.join(condicionesDeConsulta(consulta), " AND ");
    const limite = topeDeOrdenes();

    // `LIMIT tope + 1`: el `+1` es lo que permite detectar el desbordamiento SIN un `COUNT`
    // aparte (patron `rangoDeArchivo` de la 344). Si vuelven `tope + 1` filas, el recorte
    // supera el tope y no se sirve ninguna cifra.
    //
    // `ORDER BY o."id", g."id"` es TOTAL y ESTABLE: sin el, el `LIMIT` cortaria un conjunto
    // distinto entre dos lecturas iguales y la misma pantalla daria dos cifras (R25).
    //
    // `LEFT JOIN` a cierre y a detalle, no `INNER`: las gestiones entregadas SIN cierre
    // aprobado tienen que entrar — son justamente el «pendiente» (R28).
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      SELECT o."id"             AS orden_id,
             o."tienda_id"      AS tienda_id,
             t."nombre"         AS tienda_nombre,
             o."producto"       AS producto,
             o."num_guia"       AS num_guia,
             o."num_remision"   AS num_remision,
             o."destinatario"   AS destinatario,
             g."id"             AS gestion_id,
             g."resultado"      AS resultado,
             g."monto_recibido" AS monto_recibido,
             c."estado"::text   AS cierre_estado,
             d."id"             AS detalle_id,
             d."monto_cobrar"                    AS monto_cobrar,
             d."cobra_comision"                  AS cobra_comision,
             d."es_central"                      AS es_central,
             d."es_zona_especial"                AS es_zona_especial,
             d."tarifa_id"                       AS tarifa_id,
             d."tarifa_valor_flete"              AS tarifa_valor_flete,
             d."tarifa_valor_flete_gam"          AS tarifa_valor_flete_gam,
             d."tarifa_valor_flete_devuelto"     AS tarifa_valor_flete_devuelto,
             d."tarifa_valor_flete_devuelto_gam" AS tarifa_valor_flete_devuelto_gam,
             d."tarifa_comision_cod"             AS tarifa_comision_cod,
             d."tarifa_iva_flete"                AS tarifa_iva_flete,
             d."tarifa_iva_comision_cod"         AS tarifa_iva_comision_cod,
             d."tarifa_especial"                 AS tarifa_especial,
             d."tarifa_especial_devuelta"        AS tarifa_especial_devuelta
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
      JOIN "usuario"      t ON t."id" = o."tienda_id"
      LEFT JOIN LATERAL (
        SELECT g2."resultado", g2."created_at"
        FROM "gestion_orden" g2
        WHERE g2."orden_id" = o."id"
          AND g2."anulada_at" IS NULL
        ORDER BY g2."created_at" DESC, g2."id" DESC
        LIMIT 1
      ) u ON TRUE
      JOIN "gestion_orden" g ON g."orden_id" = o."id"
                            AND g."anulada_at" IS NULL
                            AND g."resultado"::text IN (${resultadosQueAportan()})
      LEFT JOIN "cierre_dia"    c ON c."id" = g."cierre_id"
      LEFT JOIN "cierre_detail" d ON d."cierre_id" = g."cierre_id" AND d."orden_id" = o."id"
      WHERE ${where}
      ORDER BY o."id", g."id"
      LIMIT ${limite + 1}`;

    if (filas.length > limite) return { estado: "limite_excedido", limite };

    return {
      estado: "ok",
      filas: filas.map(
        (f): FilaDineroCruda => ({
          ordenId: f.orden_id,
          tiendaId: f.tienda_id,
          tiendaNombre: f.tienda_nombre,
          producto: f.producto,
          // El numero VISIBLE con el que se habla de la orden (R36): la guia si la tiene, si no
          // la remision. `String(...)` sobre un ENTERO de identificacion, que no es dinero.
          guia: f.num_guia === null ? f.num_remision : String(f.num_guia),
          numGuia: f.num_guia,
          destinatario: f.destinatario,
          gestionId: f.gestion_id,
          resultado: f.resultado,
          // Money-safe: `Decimal -> STRING escala 2` YA en el repositorio, mismo criterio que
          // `CierreAporteRepository`. Ningun importe sale de aqui como `number`.
          montoRecibido: f.monto_recibido === null ? null : f.monto_recibido.toFixed(2),
          cierreEstado: f.cierre_estado,
          congelada: congeladaDe(f),
        }),
      ),
    };
  }
}
