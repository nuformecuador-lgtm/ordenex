import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

import { HistorialAccionRepository } from "@/lib/repositories/HistorialAccionRepository";
import { HistorialAccionService } from "@/lib/services/HistorialAccionService";
import { CODIGO_VIGENTE_DE_ANTERIOR } from "@/lib/types/order-status";
import { HAY_BASE_DE_DATOS } from "../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../454/_escenario";

/**
 * FICHA 455 (T1.12, design §3.4; R23) — un SNAPSHOT guardado ANTES de la ficha (la bitacora de la
 * correccion de resultado, `historial_accion.valor_*`, con un codigo anterior) se lee con el codigo
 * VIGENTE, y la fila NO se reescribe. Contra Postgres real, por el servicio real de la pantalla.
 *
 * Los codigos anteriores no se escriben a mano (G1): salen de `CODIGO_VIGENTE_DE_ANTERIOR`.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const ANTERIOR_DE = (vigente: string) =>
  Object.entries(CODIGO_VIGENTE_DE_ANTERIOR).find(([, v]) => v === vigente)![0];

describeSiHayBase("455/R23 — el snapshot de un codigo anterior se lee con el vigente", () => {
  let mundo: Mundo;
  let r: {
    leido: { anterior: string | null; nuevo: string | null }[];
    enBase: { anterior: string | null; nuevo: string | null }[];
  };

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await conEscenario(mundo, async (e) => {
      const insertar = async (accion: string, anterior: string, nuevo: string) => {
        const id = randomUUID();
        await e.tx.$executeRawUnsafe(
          `INSERT INTO "historial_accion"
             ("id", "accion", "entidad_tipo", "entidad_id", "entidad_etiqueta", "lote_id",
              "actor_usuario_id", "actor_nombre", "actor_rol", "valor_anterior", "valor_nuevo")
           VALUES ($1, $2::"historial_accion_tipo", 'gestion_orden', $3, 'gestion 455', $1, $4, 'Maestro 455', 'maestro', $5, $6)`,
          id,
          accion,
          randomUUID(),
          e.maestroId,
          anterior,
          nuevo,
        );
        return id;
      };
      // Un snapshot de ANTES de la 455: la correccion guardo los codigos de su epoca.
      const idSnap = await insertar(
        "cierre_dia_gestion_corregida",
        ANTERIOR_DE("entregado"),
        ANTERIOR_DE("devolucion_a_origen_por_rechazo"),
      );
      const servicio = new HistorialAccionService(new HistorialAccionRepository(e.cliente));
      const listado = await servicio.listar(
        { accion: ["cierre_dia_gestion_corregida"], actorId: [e.maestroId], pageSize: 50 },
        e.actorMaestro,
      );
      if (listado.status !== "ok") throw new Error(`listar no fue ok: ${listado.status}`);
      const enBase = await e.tx.historialAccion.findMany({
        where: { id: idSnap },
        select: { valorAnterior: true, valorNuevo: true },
      });
      return {
        leido: listado.items.filter((i) => i.id === idSnap).map((i) => ({ anterior: i.valorAnterior, nuevo: i.valorNuevo })),
        enBase: enBase.map((b) => ({ anterior: b.valorAnterior, nuevo: b.valorNuevo })),
      };
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("R23: la pantalla lee el codigo VIGENTE (literal a mano)", () => {
    expect(r.leido).toEqual([{ anterior: "entregado", nuevo: "devolucion_a_origen_por_rechazo" }]);
  });

  it("R23: la fila de la base NO se reescribe: sigue diciendo lo que dijo", () => {
    expect(r.enBase).toEqual([
      { anterior: ANTERIOR_DE("entregado"), nuevo: ANTERIOR_DE("devolucion_a_origen_por_rechazo") },
    ]);
  });
});
