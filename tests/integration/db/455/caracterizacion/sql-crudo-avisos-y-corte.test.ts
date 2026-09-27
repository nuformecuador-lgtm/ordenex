import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { AvisoAgregadoRepository } from "@/lib/repositories/AvisoAgregadoRepository";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C06 (R46, R53). EL AVISO AGREGADO DIARIO Y EL CORTE NOCTURNO.
 *
 * `AvisoAgregadoRepository` cuenta por CODIGO: las novedades de la tienda (`C.novedad` con su gestion
 * `R.novedad`) y las devoluciones represadas (`C.porDevolverCentral` anclada antes del umbral). El corte
 * nocturno (`CorteDiarioService` + `CierreDiaRepository.crearCierre`) resuelve el codigo del estado al
 * que barre (`C.novedadInterna`). Mundo propio en tx revertida:
 *  - avisos: N1 `C.novedad` con gestion `R.novedad` (not_found) · N2 `C.novedad` sin gestion ·
 *    X `C.rechazo` (no cuenta) · P1 `C.porDevolverCentral` anclada hace 30 dias (represada) ·
 *    P2 `C.porDevolverCentral` anclada hoy (aun no) · P3 `C.novedad` (no es represada);
 *  - corte: E1 en mano (`C.enReparto`) · E2 `C.recogiendo` · E3 con gestion `R.entregado` pendiente.
 * Invariantes: los conteos del aviso para la tienda y la zona del escenario; tras el corte REAL, E1
 * barrida a `C.novedadInterna` y vinculada al `vencido` con origen `C.enReparto`, E2 y E3 intactas.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const DIA = 24 * 60 * 60 * 1000;

describeSiHayBase("455/C06 — aviso agregado y corte nocturno (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  function correr() {
    return conEscenario(mundo, async (e) => {
      const ahora = new Date();
      const nombre = new Map<string, string>();
      const sembrar = async (n: string, clave: keyof typeof C, zona: "central" | "satelite" = "satelite") => {
        const o = await e.sembrarOrden({ estatus: C[clave] as never, zona, mensajeroId: null, montoCobrar: 1000 });
        nombre.set(o.ordenId, n);
        return o.ordenId;
      };
      const n1 = await sembrar("N1", "novedad");
      await e.tx.gestionOrden.create({
        data: {
          ordenId: n1,
          mensajeroId: e.mensajeroId,
          resultado: R.novedad as never,
          causaDevolucion: "not_found",
          createdAt: new Date(ahora.getTime() - 2 * DIA),
        },
      });
      await sembrar("N2", "novedad");
      await sembrar("X", "rechazo");
      const p1 = await sembrar("P1", "porDevolverCentral");
      await e.tx.ordenHistorialEstado.create({
        data: {
          ordenId: p1,
          estatusDestinoId: e.id(C.porDevolverCentral),
          origenTipo: "ajuste_estado",
          createdAt: new Date(ahora.getTime() - 30 * DIA),
        },
      });
      const p2 = await sembrar("P2", "porDevolverCentral");
      await e.tx.ordenHistorialEstado.create({
        data: { ordenId: p2, estatusDestinoId: e.id(C.porDevolverCentral), origenTipo: "ajuste_estado", createdAt: ahora },
      });
      await sembrar("P3", "novedad");

      const aviso = new AvisoAgregadoRepository(e.cliente, e.s.ordenRepo);
      const resumen = (await aviso.resumenNovedadesPorTienda()).find((t) => t.tiendaId === e.tiendaId);
      const novedades = resumen
        ? { total: resumen.total, ordenes: resumen.ordenes.map((o) => `${nombre.get(o.ordenId)}:${o.causa ?? "-"}`).sort() }
        : null;
      const contadas = await aviso.contarNovedadesDeTienda(e.tiendaId);
      const umbral = new Date(ahora.getTime() - 7 * DIA);
      const represadasZona = (await aviso.resumenRepresadasPorZona(umbral)).find((z) => z.zonaId === e.zonaSateliteId);
      const represadas = await aviso.contarRepresadas(umbral, e.zonaSateliteId);

      // --- El corte nocturno REAL sobre el mensajero del escenario.
      const e1 = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 2000 });
      const e2 = await e.sembrarOrden({ estatus: C.recogiendo as never, montoCobrar: 2000 });
      const e3 = await e.sembrarOrden({ estatus: C.enReparto as never, montoCobrar: 2000 });
      await e.gestionarOk(e3.ordenId, R.entregado as never, { monto: 2000 });
      const corte = await e.correrCorte(ahora);
      const vencido = await e.tx.cierreDia.findFirst({
        where: { mensajeroId: e.mensajeroId, estado: "vencido" },
        select: { id: true },
      });
      if (vencido === null) throw new Error(`el corte no creo el vencido: ${JSON.stringify(corte)}`);
      const vinculos = await e.tx.cierreSinGestion.findMany({
        where: { cierreId: vencido.id },
        select: { ordenId: true, estatusOrigenId: true },
      });
      const nombreCorte = new Map([
        [e1.ordenId, "E1"],
        [e2.ordenId, "E2"],
        [e3.ordenId, "E3"],
      ]);
      return {
        novedades,
        contadas,
        represadasZona: represadasZona?.total ?? 0,
        represadas,
        vencidosCreados: corte.vencidosCreados,
        vinculos: vinculos
          .map((v) => `${nombreCorte.get(v.ordenId) ?? "ajena"}<-${claveDe(mundo.valorDeEstatus.get(v.estatusOrigenId ?? ""))}`)
          .sort(),
        trasCorte: {
          E1: claveDe(await e.estadoDe(e1.ordenId)),
          E2: claveDe(await e.estadoDe(e2.ordenId)),
          E3: claveDe(await e.estadoDe(e3.ordenId)),
        },
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

  it("aviso de novedades: la tienda tiene 3 en novedad (N1 con su causa, N2 y P3 sin gestion) y X no cuenta", () => {
    expect(r.novedades).toEqual({ total: 3, ordenes: ["N1:not_found", "N2:-", "P3:-"] });
    expect(r.contadas).toBe(3);
  });

  it("represadas de la zona: solo P1 (anclada antes del umbral)", () => {
    expect(r.represadasZona).toBe(1);
    expect(r.represadas).toBe(1);
  });

  it("el corte crea UN vencido y barre solo E1 a novedadInterna, vinculada con origen enReparto", () => {
    expect(r.vencidosCreados).toBe(1);
    expect(r.vinculos).toEqual(["E1<-enReparto"]);
    expect(r.trasCorte).toEqual({ E1: "novedadInterna", E2: "recogiendo", E3: "enReparto" });
  });
});
