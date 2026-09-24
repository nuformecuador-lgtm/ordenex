import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { devolucionSlaConfig } from "@/lib/config/devolucion-sla";
import { DevolucionSlaRepository } from "@/lib/repositories/DevolucionSlaRepository";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { C, R, claveDe } from "../../../../fixtures/codigos-455";
import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, prepararMundo, type Escenario, type Mundo } from "../../454/_escenario";

/**
 * FEATURE 455 — FASE 0 · C03 (R46). EL CRON DE DEVOLUCIONES: SUS CANDIDATAS PARA UN RELOJ DADO.
 *
 * `DevolucionSlaRepository.findDevueltasSla` selecciona por el CODIGO del estado (`estatus.value`) y por
 * el CODIGO del resultado de la gestion: exactamente lo que la 455 renombra. Mundo propio en tx
 * revertida, gestiones sembradas como fixture con instantes fijos:
 *  - A: en `C.novedad` con gestion vigente `R.novedad` (causa `wrong_address`) y fila de anclaje;
 *  - B: en `C.novedad` con gestion vigente `R.novedad` SIN anclaje (rama legada);
 *  - N1: en `C.novedad` SIN gestion `R.novedad` vigente (la suya esta anulada) -> se ignora;
 *  - N2: en `C.enReparto` con gestion `R.novedad` -> no es candidata;
 *  - N3: en `C.rechazo` con gestion `R.rechazo` -> no es candidata.
 * Invariantes: las candidatas del escenario son A (ancla = aprobacion) y B (ancla = su gestion), y el
 * cron REAL, a un reloj pasada la ventana de A y B, escala las dos a `C.rechazo` y no toca las demas.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const DIA = 24 * 60 * 60 * 1000;
const T_GESTION = new Date("2026-09-01T15:00:00.000Z");
const T_ANCLA = new Date("2026-09-02T15:00:00.000Z");

describeSiHayBase("455/C03 — candidatas del cron de devoluciones (Postgres real)", () => {
  let mundo: Mundo;
  let r: Awaited<ReturnType<typeof correr>>;

  async function gestion(
    e: Escenario,
    ordenId: string,
    resultado: string,
    opts: { anulada?: boolean } = {},
  ): Promise<void> {
    await e.tx.gestionOrden.create({
      data: {
        ordenId,
        mensajeroId: e.mensajeroId,
        resultado: resultado as never,
        causaDevolucion: resultado === R.novedad ? "wrong_address" : null,
        anuladaAt: opts.anulada ? new Date(T_GESTION.getTime() + 60_000) : null,
        createdAt: T_GESTION,
      },
    });
  }

  function correr() {
    return conEscenario(mundo, async (e) => {
      const nombre = new Map<string, string>();
      const sembrar = async (n: string, clave: keyof typeof C) => {
        const o = await e.sembrarOrden({ estatus: C[clave] as never, zona: "satelite", montoCobrar: 1000 });
        nombre.set(o.ordenId, n);
        return o.ordenId;
      };
      const a = await sembrar("A", "novedad");
      await gestion(e, a, R.novedad);
      await e.tx.ordenHistorialEstado.create({
        data: { ordenId: a, estatusDestinoId: e.id(C.novedad), origenTipo: "anclaje_devolucion", createdAt: T_ANCLA },
      });
      const b = await sembrar("B", "novedad");
      await gestion(e, b, R.novedad);
      const n1 = await sembrar("N1", "novedad");
      await gestion(e, n1, R.novedad, { anulada: true });
      const n2 = await sembrar("N2", "enReparto");
      await gestion(e, n2, R.novedad);
      const n3 = await sembrar("N3", "rechazo");
      await gestion(e, n3, R.rechazo);

      const repo = new DevolucionSlaRepository(e.cliente);
      const candidatas = (await repo.findDevueltasSla())
        .filter((c) => nombre.has(c.ordenId))
        .map((c) => ({
          orden: nombre.get(c.ordenId),
          ancladaAt: c.ancladaAt.toISOString(),
          origenAncla: c.origenAncla,
          causa: c.causa,
        }))
        .sort((x, y) => String(x.orden).localeCompare(String(y.orden)));

      const ventana = devolucionSlaConfig.DIAS_RECHAZO_AUTOMATICO * DIA;
      const cron = new DevolucionSlaService(repo, e.s.zonaRepo, e.s.ordenRepo, e.s.historialService, {
        warn: () => {},
      });
      await cron.ejecutar(new Date(T_ANCLA.getTime() + ventana + 60 * 60 * 1000));
      const estados: Record<string, string> = {};
      for (const [id, n] of nombre) estados[n] = claveDe(await e.estadoDe(id));
      return { candidatas, estados, ventana };
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r = await correr();
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("las candidatas del escenario son A (anclada en la aprobacion) y B (legada, anclada en su gestion)", () => {
    expect(r.candidatas).toEqual([
      { orden: "A", ancladaAt: T_ANCLA.toISOString(), origenAncla: "aprobacion", causa: "wrong_address" },
      { orden: "B", ancladaAt: T_GESTION.toISOString(), origenAncla: "legado", causa: "wrong_address" },
    ]);
  });

  it("el cron pasada la ventana escala A y B a rechazo y no toca N1, N2 ni N3", () => {
    expect(r.ventana).toBeGreaterThan(0);
    expect(r.estados).toEqual({
      A: "rechazo",
      B: "rechazo",
      N1: "novedad",
      N2: "enReparto",
      N3: "rechazo",
    });
  });
});
