// Ficha 475 (design §4, R8-R14, R16, R40) — SELECCION del informe de transito en Postgres.
//
// SOLO LECTURA y SQL crudo con `Prisma.sql` (todo valor viaja como parametro `$n`; el fragmento
// del hito sale de un MAPA CERRADO de tres `Prisma.Sql`, nunca de texto del usuario).
//
// EL DIA NO SE CALCULA AQUI. La frontera «lleva N dias» llega ya convertida en un INSTANTE por
// zona (`cortes`, calculados en TS con los helpers de `fecha-cr`): `hito < corte` ⇔ `dias >= umbral`.
// La base no hace aritmetica de husos (cero `AT TIME ZONE`), asi que el filtro y los dias que pinta
// el PDF salen de la MISMA definicion del dia de Costa Rica (design §4, alternativa 1 descartada).
//
// Tres consultas fijas por generacion (`zonas`, `filasEnAlerta`, `contarSinHito`): el numero de
// consultas no depende del numero de ordenes (R40), y solo vuelven las ordenes en alerta.
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { Hito } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type {
  ConsultaTransito,
  FilaTransito,
  ZonaInforme,
} from "@/lib/whatsapp-envios/informes/transito/tipos";

/** Cliente minimo: solo lecturas crudas. Sin `$executeRaw`: este repo no puede escribir (R39). */
export type InformeTransitoPrismaClient = Pick<PrismaClient, "$queryRaw">;

/**
 * El instante del hito de la orden `c` (design §1). Mapa CERRADO: el hito elige un fragmento fijo.
 *
 * - entrada a bodega central (R11): la PRIMERA transicion cuyo DESTINO es `en_bodega_central`. Por
 *   destino y no por `origen_tipo`: una via nueva hacia la central queda cubierta sola. `MIN`: un
 *   reingreso no reinicia el conteo.
 * - creacion (R12): `orden.created_at`.
 * - generacion de guia (R13): la mas antigua de `generacion_guia`, `ruteo_satelite` y la creacion
 *   en `por_recolectar_en_tienda` (nace con guia). Exige `num_guia`: no hay columna con el instante
 *   de la guia, y esos tres eventos son los unicos que la asignan.
 */
const FRAGMENTO_HITO: Record<Hito, Prisma.Sql> = {
  entrada_bodega_central: Prisma.sql`
    SELECT MIN(h."created_at") AS "at"
      FROM "orden_historial_estado" h
      JOIN "order_status" sd ON sd."id" = h."estatus_destino_id"
     WHERE h."orden_id" = c."id" AND sd."value" = 'en_bodega_central'`,
  creacion: Prisma.sql`SELECT c."created_at" AS "at"`,
  generacion_guia: Prisma.sql`
    SELECT MIN(h."created_at") AS "at"
      FROM "orden_historial_estado" h
      JOIN "order_status" sd ON sd."id" = h."estatus_destino_id"
     WHERE h."orden_id" = c."id"
       AND c."num_guia" IS NOT NULL
       AND (h."origen_tipo" IN ('generacion_guia', 'ruteo_satelite')
            OR (h."estatus_origen_id" IS NULL AND sd."value" = 'por_recolectar_en_tienda'))`,
};

/** `cand`: ordenes vivas en un estado incluido, NUNCA de cierre logistico (R9/R10). */
function candidatas(consulta: ConsultaTransito): Prisma.Sql {
  return Prisma.sql`
    SELECT o."id", o."zona_id", o."num_remision", o."num_guia", o."destinatario",
           o."monto_cobrar", o."created_at", o."canton_id", o."distrito_id", s."value" AS "estado"
      FROM "orden" o
      JOIN "order_status" s ON s."id" = o."estatus_id"
     WHERE o."deleted_at" IS NULL
       AND s."value" IN (${Prisma.join([...consulta.estados])})
       AND s."value" NOT IN ('entregado', 'devuelta_a_tienda')`;
}

/** `cortes(zona_id, corte)` como VALUES parametrizado. */
function valoresDeCortes(consulta: ConsultaTransito): Prisma.Sql {
  return Prisma.join(
    consulta.cortes.map((c) => Prisma.sql`(${c.zonaId}::text, ${c.corte}::timestamp)`),
  );
}

interface FilaCruda {
  orden_id: string;
  num_remision: string;
  num_guia: number | null;
  estado: string;
  zona_id: string;
  destinatario: string;
  canton: string;
  distrito: string | null;
  monto_cobrar: string | null;
  hito_at: Date;
  ultima_at: Date | null;
}

export class InformeTransitoRepository implements IInformeTransitoRepository {
  constructor(private readonly prisma: InformeTransitoPrismaClient) {}

  async zonas(): Promise<ZonaInforme[]> {
    const filas = await this.prisma.$queryRaw<{ id: string; nombre: string; es_central: boolean }[]>`
      SELECT z."id", z."nombre", z."es_central" FROM "zona" z ORDER BY z."nombre" ASC, z."id" ASC`;
    return filas.map((f) => ({ id: f.id, nombre: f.nombre, esCentral: f.es_central }));
  }

  async filasEnAlerta(consulta: ConsultaTransito): Promise<FilaTransito[]> {
    if (consulta.cortes.length === 0 || consulta.estados.length === 0) return [];
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      WITH "cortes"("zona_id", "corte") AS (VALUES ${valoresDeCortes(consulta)}),
      "cand" AS (${candidatas(consulta)})
      SELECT c."id" AS "orden_id", c."num_remision", c."num_guia", c."estado", c."zona_id",
             c."destinatario", c."monto_cobrar"::text AS "monto_cobrar",
             k."nombre" AS "canton", d."nombre" AS "distrito",
             hito."at" AS "hito_at", ult."at" AS "ultima_at"
        FROM "cand" c
        JOIN "cortes" z ON z."zona_id" = c."zona_id"
        JOIN "canton" k ON k."id" = c."canton_id"
        LEFT JOIN "distrito" d ON d."id" = c."distrito_id"
        CROSS JOIN LATERAL (${FRAGMENTO_HITO[consulta.hito]}) hito
        LEFT JOIN LATERAL (
          SELECT h."created_at" AS "at"
            FROM "orden_historial_estado" h
           WHERE h."orden_id" = c."id"
           ORDER BY h."created_at" DESC, h."id" DESC
           LIMIT 1
        ) ult ON true
       WHERE hito."at" IS NOT NULL
         AND hito."at" < z."corte"`;
    return filas.map((f) => ({
      ordenId: f.orden_id,
      numRemision: f.num_remision,
      numGuia: f.num_guia === null ? null : Number(f.num_guia),
      estado: f.estado,
      zonaId: f.zona_id,
      destinatario: f.destinatario,
      canton: f.canton,
      distrito: f.distrito,
      montoCobrar: f.monto_cobrar,
      hitoAt: f.hito_at,
      ultimaTransicionAt: f.ultima_at,
    }));
  }

  async contarSinHito(consulta: ConsultaTransito): Promise<number> {
    if (consulta.cortes.length === 0 || consulta.estados.length === 0) return 0;
    const filas = await this.prisma.$queryRaw<{ n: bigint | number }[]>`
      WITH "cortes"("zona_id", "corte") AS (VALUES ${valoresDeCortes(consulta)}),
      "cand" AS (${candidatas(consulta)})
      SELECT COUNT(*)::int AS "n"
        FROM "cand" c
        JOIN "cortes" z ON z."zona_id" = c."zona_id"
        CROSS JOIN LATERAL (${FRAGMENTO_HITO[consulta.hito]}) hito
       WHERE hito."at" IS NULL`;
    return Number(filas[0]?.n ?? 0);
  }
}
