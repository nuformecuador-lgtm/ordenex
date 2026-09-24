import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { OrdenService } from "@/lib/services/OrdenService";
import { VistaFiltroRepository } from "@/lib/repositories/VistaFiltroRepository";
import { leerPayloadGuardado, VISTA_FILTRO_VERSION } from "@/lib/types/vista-filtro";
import { listarOrdenesSchema } from "@/lib/types/orden";
import { seleccionAFilter } from "@/app/(app)/ordenes/_components/seleccion-a-filter";
import { CLAVE_ESTADO } from "@/app/(app)/ordenes/_components/ordenes-filtros-def";
import { C, type ClaveEstado } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C01 (R21, R45). EL FILTRO POR ESTADO DE `/ordenes` Y UNA VISTA GUARDADA.
 *
 * `/ordenes` filtra por ID de catalogo (`filter.status_id`), no por codigo: el renombre de la 455 es un
 * `UPDATE` de `order_status.value` que conserva el id, asi que el filtro y las vistas guardadas (453)
 * deben devolver EXACTAMENTE las mismas ordenes antes y despues.
 *
 * Mundo propio en tx revertida: DOS ordenes en cada uno de los 7 estados que la 455 renombra y dos en
 * `C.enReparto` como ruido. Por el SERVICIO REAL (`OrdenService.listar`, actor maestro, acotado a la
 * tienda del escenario):
 *  - filtrar por el id de cada estado devuelve SUS dos ordenes y ninguna otra;
 *  - una vista guardada por `VistaFiltroRepository.crear` con dos de esos ids, releida con
 *    `leerPayloadGuardado` y traducida con `seleccionAFilter` (el camino de la pantalla), devuelve
 *    exactamente las cuatro.
 * Sin `[INTERMEDIO]`: nada de esto cambia por diseño.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const RENOMBRADOS: readonly ClaveEstado[] = [
  "entregado",
  "novedad",
  "reprogramado",
  "recogiendo",
  "rechazo",
  "novedadInterna",
  "porDevolverCentral",
];

describeSiHayBase("455/C01 — filtro por estado de /ordenes y vista guardada (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const nombre = new Map<string, string>();
      for (const clave of [...RENOMBRADOS, "enReparto" as const]) {
        for (const n of [1, 2]) {
          const o = await e.sembrarOrden({ estatus: C[clave] as never, mensajeroId: null });
          nombre.set(o.ordenId, `${clave}#${n}`);
        }
      }
      const servicio = new OrdenService(e.s.ordenRepo, e.s.historialService);
      const listar = async (filter: Record<string, unknown>) => {
        const input = listarOrdenesSchema.parse({
          page: 1,
          pageSize: 100,
          filter: { ...filter, tienda_id: [e.tiendaId] },
        });
        const res = await servicio.listar(input, e.actorMaestro);
        if (res.status !== "ok") throw new Error(`listar no fue ok: ${JSON.stringify(res)}`);
        return res.items.map((i) => nombre.get(i.id) ?? `ajena:${i.id}`).sort();
      };

      const porEstado: Record<string, string[]> = {};
      for (const clave of RENOMBRADOS) porEstado[clave] = await listar({ status_id: [e.id(C[clave])] });
      const sinFiltro = await listar({});

      // La vista guardada: la escribe el repositorio real con el formato v1 de la 453.
      const vistas = new VistaFiltroRepository(e.cliente);
      const creada = await vistas.crear(
        e.maestroId,
        "ordenes",
        "455 C01",
        {
          v: VISTA_FILTRO_VERSION,
          termino: "",
          activos: [CLAVE_ESTADO],
          seleccion: { [CLAVE_ESTADO]: [e.id(C.novedad), e.id(C.rechazo)] },
        },
        VISTA_FILTRO_VERSION,
      );
      const guardadas = await vistas.listar(e.maestroId, "ordenes");
      const payload = leerPayloadGuardado(guardadas.find((v) => v.nombre === "455 C01")?.filtro);
      if (payload === null) throw new Error("la vista guardada no se pudo releer");
      const conVista = await listar(seleccionAFilter(payload.seleccion));
      return { porEstado, sinFiltro, creada: creada.estado, conVista };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("precondicion: sin filtro de estado salen las 16 ordenes del escenario", () => {
    expect(r.sinFiltro).toHaveLength(16);
    expect(r.sinFiltro.every((n) => !n.startsWith("ajena:"))).toBe(true);
  });

  it("filtrar por el id de cada uno de los 7 estados renombrados devuelve SUS dos ordenes", () => {
    expect(r.porEstado).toEqual(
      Object.fromEntries(RENOMBRADOS.map((k) => [k, [`${k}#1`, `${k}#2`]])),
    );
  });

  it("una vista guardada con dos estados devuelve exactamente sus cuatro ordenes", () => {
    expect(r.creada).toBe("creada");
    expect(r.conVista).toEqual(["novedad#1", "novedad#2", "rechazo#1", "rechazo#2"]);
  });
});
