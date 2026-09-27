import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { HAY_BASE_DE_DATOS } from "../../_postgres-real";
import { conEscenario, diaCR, prepararMundo, type Escenario, type Mundo } from "../_escenario";

/**
 * FEATURE 454 — FASE 0 · C08 (R52). LA PRECONDICION PARA SOLICITAR EL CIERRE, sobre el codigo de HOY.
 *
 * Cuatro jornadas, cada una en su propio escenario: todo gestionado -> solicita; una en mano ->
 * bloqueado; una con ayuda -> bloqueado; una reservada para mañana -> solicita.
 */

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

type Resultado = { status: string; via?: string; motivo?: string };

describeSiHayBase("454/C08 — cuando se puede solicitar el cierre (Postgres real)", () => {
  let mundo: Mundo;
  const r: Record<string, Resultado> = {};

  async function jornada(extra: (e: Escenario) => Promise<void>): Promise<Resultado> {
    return conEscenario(mundo, async (e) => {
      const hecha = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 2000 });
      await e.gestionarOk(hecha.ordenId, "entregado", { monto: 2000 });
      await extra(e);
      return (await e.solicitarCierre()) as Resultado;
    });
  }

  beforeAll(async () => {
    mundo = await prepararMundo();
    r.todoGestionado = await jornada(async () => {});
    r.unaEnMano = await jornada(async (e) => {
      await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
    });
    r.unaConAyuda = await jornada(async (e) => {
      const o = await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000 });
      const a = await e.pedirAyuda(o.ordenId);
      if (a.status !== "ok") throw new Error(`pedirAyuda: ${JSON.stringify(a)}`);
    });
    r.reservadaManana = await jornada(async (e) => {
      await e.sembrarOrden({ estatus: "en_reparto", montoCobrar: 1000, fechaReparto: diaCR(1) });
    });
  }, 120_000);

  afterAll(async () => {
    await mundo?.prisma.$disconnect();
  });

  it("todo gestionado -> crea el cierre", () => {
    expect(r.todoGestionado).toMatchObject({ status: "ok", via: "creado" });
  });

  it("una orden en mano -> bloqueado (`conflict`)", () => {
    expect(r.unaEnMano.status).toBe("conflict");
  });

  it("una orden con ayuda pedida -> bloqueado (`conflict`)", () => {
    expect(r.unaConAyuda.status).toBe("conflict");
  });

  it("una orden reservada para mañana NO bloquea -> crea el cierre", () => {
    expect(r.reservadaManana).toMatchObject({ status: "ok", via: "creado" });
  });
});
