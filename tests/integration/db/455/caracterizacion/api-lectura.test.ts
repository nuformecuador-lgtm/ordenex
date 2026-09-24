import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { handleListadoApi } from "@/app/api/ordenes/api-key/route";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import { BulkOrdenService } from "@/lib/services/BulkOrdenService";
import { C, R, claveDe, type ClaveEstado } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C12 (R24, R26, R27). LA API POR API KEY: LISTADO, DETALLE Y CARGA.
 *
 * El canal de integracion publica CODIGOS: el filtro `estado` del listado es un `z.enum` de codigos que
 * el servicio resuelve a id (`findEstatusIdByValue`), el item lleva `estado`, el detalle lleva
 * `gestiones[].resultado`/`estadoResultante` y la carga devuelve `filas[].estatus`. Mundo propio en tx
 * revertida, la tienda del escenario como dueña (actor `apiKey`):
 *  - una orden en cada uno de los 7 estados que la 455 renombra y una en `C.enReparto`;
 *  - una orden con una gestion `R.novedad` APROBADA y otra con una `R.entregado` PENDIENTE (454).
 * Invariantes: por la ruta REAL (`handleListadoApi`) filtrar por cada codigo devuelve 200 y SOLO su orden,
 * con `estado` = ese codigo; un codigo inventado responde 422; el detalle devuelve las gestiones con su
 * resultado y estado resultante; la carga reconoce la remision duplicada y crea la nueva.
 * `[INTERMEDIO]` (R24/R27): las claves del item, de `gestiones[]` y de `filas[]` tal como son HOY.
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
const SIN_FIRMA: ISignedUrlProvider = {
  createSignedUrl: async (ruta: string) => ruta,
  createSignedUrls: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, r])),
};

describeSiHayBase("455/C12 — API por API key: listado, detalle y carga (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const actorKey: Actor = { usuarioId: e.tiendaId, rol: "apiKey" };
      const remision = new Map<string, string>();
      const remisionDe = async (ordenId: string) =>
        (await e.tx.orden.findUniqueOrThrow({ where: { id: ordenId }, select: { numRemision: true } })).numRemision;
      for (const clave of [...RENOMBRADOS, "enReparto" as const]) {
        const o = await e.sembrarOrden({ estatus: C[clave] as never, mensajeroId: null });
        remision.set(await remisionDe(o.ordenId), clave);
      }

      const lectura = new ApiOrdenLecturaService(
        new OrdenRepository(e.cliente),
        SIN_FIRMA,
        new TarifaVigenteRepository(e.cliente),
      );
      const deps = {
        autenticar: async () => ({ status: "ok" as const, actor: actorKey, apiKeyId: "key-455" }),
        lecturaService: lectura,
      };
      const pedir = async (query: string) => {
        const res = await handleListadoApi(new Request(`http://localhost/api/ordenes/api-key?${query}`), deps);
        const cuerpo = (await res.json()) as { items?: { numRemision: string; estado: string }[] };
        return { status: res.status, cuerpo };
      };
      const porEstado: Record<string, unknown> = {};
      let clavesItem: string[] = [];
      for (const clave of RENOMBRADOS) {
        const { status, cuerpo } = await pedir(`estado=${C[clave]}&limit=100`);
        const items = cuerpo.items ?? [];
        if (clave === "entregado" && items[0]) clavesItem = Object.keys(items[0]);
        porEstado[clave] = {
          status,
          items: items.map((i) => `${remision.get(i.numRemision) ?? "ajena"}:${claveDe(i.estado)}`),
        };
      }
      const inventado = await pedir("estado=estado_que_no_existe_455");

      // Detalle: una gestion R.novedad aprobada y una R.entregado pendiente (454).
      const conNovedad = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 1000 });
      await e.gestionarOk(conNovedad.ordenId, R.novedad as never);
      const cierreId = await e.solicitarCierreOk();
      const aprobacion = await e.aprobar(cierreId);
      const pendiente = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 1000 });
      await e.gestionarOk(pendiente.ordenId, R.entregado as never, { monto: 1000 });
      const gestionesDe = async (ordenId: string) => {
        const d = await lectura.detallePorOrdenId(actorKey, ordenId);
        return (d?.gestiones ?? []).map((g) => ({
          resultado: claveDe(g.resultado),
          estadoResultante: claveDe(g.estadoResultante),
          pendiente: g.pendienteConfirmacion,
        }));
      };
      const detalleNovedad = await gestionesDe(conNovedad.ordenId);
      const detallePendiente = await gestionesDe(pendiente.ordenId);
      const detalleCrudo = await lectura.detallePorOrdenId(actorKey, conNovedad.ordenId);
      const clavesGestion = detalleCrudo?.gestiones[0] ? Object.keys(detalleCrudo.gestiones[0]) : [];

      // Carga: la remision de la orden en `C.entregado` vuelve como duplicada; una nueva se crea.
      const remEntregado = [...remision].find(([, k]) => k === "entregado")?.[0] ?? "";
      // La geografia se valida ANTES que el duplicado: se toma un distrito activo con zona de la base.
      const distrito = await e.tx.distrito.findFirst({
        where: { activo: true, zonas: { some: {} }, canton: { activo: true, provincia: { activo: true } } },
        select: { nombre: true, canton: { select: { nombre: true, provincia: { select: { nombre: true } } } } },
      });
      if (distrito === null) throw new Error("la base no tiene un distrito activo con zona: corre seed-zonas");
      const geo = {
        provincia: distrito.canton.provincia.nombre,
        canton: distrito.canton.nombre,
        distrito: distrito.nombre,
      };
      const bulk = new BulkOrdenService(new OrdenRepository(e.cliente), new TarifaVigenteRepository(e.cliente));
      const carga = await bulk.cargarViaApi(
        [
          { num_remision: remEntregado, destinatario: "Dest 455", telefono: "88880000", producto: "Caja", ...geo },
        ] as never,
        actorKey,
      );
      const filas =
        carga.status === "ok"
          ? carga.summary.filas.map((f) => ({
              resultado: f.resultado,
              estatus: claveDe((f as { estatus?: string }).estatus),
              claves: Object.keys(f).sort(),
            }))
          : [{ resultado: carga.status, estatus: "∅", claves: [] as string[] }];

      return {
        porEstado,
        inventado: inventado.status,
        aprobacion: aprobacion.status,
        detalleNovedad,
        detallePendiente,
        clavesItem,
        clavesGestion,
        filas,
      };
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
    it("filtrar el listado por cada uno de los 7 codigos devuelve 200 y SOLO su orden, con ese estado", () => {
      expect(r.porEstado).toEqual(
        Object.fromEntries(RENOMBRADOS.map((k) => [k, { status: 200, items: [`${k}:${k}`] }])),
      );
    });

    it("un codigo que no existe responde 422", () => {
      expect(r.inventado).toBe(422);
    });

    it("detalle: la gestion de novedad aprobada lleva su resultado y su estado resultante", () => {
      expect(r.aprobacion).toBe("ok");
      expect(r.detalleNovedad).toEqual([{ resultado: "novedad", estadoResultante: "novedad", pendiente: false }]);
    });

    it("detalle: la gestion pendiente (454) no tiene estado resultante y va marcada", () => {
      expect(r.detallePendiente).toEqual([{ resultado: "entregado", estadoResultante: "∅", pendiente: true }]);
    });

    it("carga: la remision existente vuelve como duplicada con el estado de la orden que la ocupa", () => {
      expect(r.filas.map((f) => [f.resultado, f.estatus])).toEqual([["duplicada", "entregado"]]);
    });
  });

  describe("[INTERMEDIO] lo que la 455 cambia por diseño (R24, R27)", () => {
    // Fase 0 (2026-09-24): las formas de HOY, sin `…Nombre` y con `estatus` en la carga. La Fase 1
    // (T1.6) reescribe este bloque con fecha.
    it("el item del listado no lleva estadoNombre", () => {
      expect(r.clavesItem).toContain("estado");
      expect(r.clavesItem).not.toContain("estadoNombre");
    });

    it("gestiones[] no lleva resultadoNombre ni estadoResultanteNombre", () => {
      expect(r.clavesGestion).toEqual([
        "createdAt",
        "resultado",
        "estadoResultante",
        "motivo",
        "mensajero",
        "pendienteConfirmacion",
      ]);
    });

    it("la fila de la carga lleva `estatus` (no `estado`)", () => {
      expect(r.filas[0]?.claves).toEqual(["estatus", "fila", "numRemision", "resultado"]);
    });
  });
});
