import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { RecepcionSateliteService } from "@/lib/services/RecepcionSateliteService";
import { listarOrdenesBodegaPaginadoSchema } from "@/lib/types/recepcion-satelite";
import { seleccionDesdeUrl } from "@/lib/utils/filtros-url";
import { filtroEstado } from "@/app/(app)/ordenes/_components/filtro-estado-def";
import {
  CLAVE_ESTADO,
  seleccionAFiltroSatelite,
} from "@/app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros";
import { C, type ClaveEstado } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C02 (R22, R45). EL LISTADO DE LA BODEGA SATELITE FILTRA POR CODIGO.
 *
 * A diferencia de `/ordenes`, `recepcion-satelite` filtra por el CODIGO del estado (`estados`, un
 * `z.enum(ESTADOS_BODEGA_SATELITE)`), y el codigo viaja en la URL (`?estado=<codigo>`). Mundo propio en
 * tx revertida: en la zona satelite del escenario, DOS ordenes en `C.porDevolverCentral`, DOS en
 * `C.rechazo` y DOS en `C.enReparto` (ruido), todas con su paso por la bodega satelite en el historial.
 *
 * Invariante: seleccionar `[C.porDevolverCentral, C.rechazo]` en la barra, traducirlo con
 * `seleccionAFiltroSatelite`, validarlo con el schema del borde y pedirlo al SERVICIO REAL como el
 * adminSatelite de la zona devuelve exactamente esas cuatro.
 *
 * `[INTERMEDIO]` (R22): el parametro de URL. Hoy la URL lleva el codigo que hoy existe; en la Fase 1
 * se reescribe para afirmar que un enlace con el codigo ANTERIOR aplica el vigente.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("455/C02 — filtro por codigo del listado satelite (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const nombre = new Map<string, string>();
      const claves: ClaveEstado[] = ["porDevolverCentral", "rechazo", "enReparto"];
      for (const clave of claves) {
        for (const n of [1, 2]) {
          const o = await e.sembrarOrden({ estatus: C[clave] as never, zona: "satelite", mensajeroId: null });
          await e.tx.ordenHistorialEstado.create({
            data: {
              ordenId: o.ordenId,
              estatusDestinoId: e.id(C.enBodegaSatelite),
              origenTipo: "ajuste_estado",
              createdAt: new Date(Date.UTC(2026, 8, 1, 15)),
            },
          });
          nombre.set(o.ordenId, `${clave}#${n}`);
        }
      }
      const servicio = new RecepcionSateliteService(new OrdenRepository(e.cliente), e.s.historialService);
      const pedir = async (seleccion: Record<string, string[]>) => {
        const filtro = seleccionAFiltroSatelite(seleccion);
        const input = listarOrdenesBodegaPaginadoSchema.parse({ ...filtro, page: 1, pageSize: 100 });
        const res = await servicio.listarOrdenesBodegaPaginado(input, e.actorAdminSatelite);
        if (res.status !== "ok") throw new Error(`listado no ok: ${JSON.stringify(res)}`);
        return res.items.map((i) => nombre.get(i.id) ?? `ajena:${i.id}`).sort();
      };

      const todas = await pedir({});
      const barra = await pedir({ [CLAVE_ESTADO]: [C.porDevolverCentral, C.rechazo] });

      const catalogo = await e.tx.orderStatus.findMany({ select: { id: true, value: true } });
      const def = filtroEstado(catalogo, { key: CLAVE_ESTADO, valor: "value" });
      const params = new URLSearchParams();
      params.append(CLAVE_ESTADO, C.porDevolverCentral);
      params.append(CLAVE_ESTADO, C.rechazo);
      const desdeUrl = seleccionDesdeUrl(params, [def]);
      const url = await pedir(desdeUrl);
      return { todas, barra, desdeUrl, url };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  describe("invariantes", () => {
    it("precondicion: sin filtro de estado el adminSatelite ve las 6 de su bodega y ninguna ajena", () => {
      expect(r.todas).toEqual([
        "enReparto#1",
        "enReparto#2",
        "porDevolverCentral#1",
        "porDevolverCentral#2",
        "rechazo#1",
        "rechazo#2",
      ]);
    });

    it("la seleccion [porDevolverCentral, rechazo] devuelve exactamente sus cuatro ordenes", () => {
      expect(r.barra).toEqual(["porDevolverCentral#1", "porDevolverCentral#2", "rechazo#1", "rechazo#2"]);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R22)", () => {
    // Fase 0 (2026-09-24): la URL lleva el codigo que HOY existe y se aplica tal cual. La Fase 1
    // (T1.12) reescribe este bloque para afirmar que un enlace con el codigo ANTERIOR aplica el vigente.
    it("la URL con los dos codigos de hoy se lee como esa seleccion y devuelve las mismas cuatro", () => {
      expect(r.desdeUrl).toEqual({ [CLAVE_ESTADO]: [C.porDevolverCentral, C.rechazo] });
      expect(r.url).toEqual(r.barra);
    });
  });
});
