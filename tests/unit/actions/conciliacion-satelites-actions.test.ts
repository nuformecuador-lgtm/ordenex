import { describe, it, expect, vi } from "vitest";

import {
  listarConsolidacionesSateliteAction,
  listarSaldosSatelitesAction,
  marcarConsolidacionRecibidaAction,
  revertirConciliacionAction,
} from "@/lib/actions/conciliacion-satelites";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IConciliacionSatelitesService } from "@/lib/interfaces/services/IConciliacionSatelitesService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 / T8 (R10/R27) — EL BORDE: SIN SESION, ENTRADA INVALIDA, Y LO QUE NO SE ESCRIBE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// EL ORDEN ES LA ASERCION, no un detalle de estilo:
//   1. SIN SESION se corta ANTES de validar y ANTES de construir el servicio;
//   2. `schema.parse` mata en el BORDE el monto ausente, negativo o con tres decimales (R10), y
//      —por el `.strict()`— cualquier clave colada;
//   3. el ROL lo decide el SERVICIO (eso se mide en `conciliacion-satelites-service.test.ts`).
//
// En los dos primeros casos, `expect(service.x).not.toHaveBeenCalled()` es lo que afirma que NO SE
// ESCRIBE NADA: R10 dice «y NO DEBE escribir nada», y eso no se prueba mirando el `status`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const CB = "22222222-2222-4222-8222-222222222222";
const ZONA = "11111111-1111-4111-8111-111111111111";

function fakeService(overrides: Partial<IConciliacionSatelitesService> = {}) {
  return {
    listarSaldosSatelites: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    })),
    listarSaldosSatelitesCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    listarConsolidacionesSatelite: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    })),
    listarConsolidacionesSateliteCompleto: vi.fn(async () => ({
      status: "ok" as const,
      items: [],
      total: 0,
    })),
    marcarRecibida: vi.fn(async () => ({ status: "ok" as const, cierreBodegaId: CB })),
    revertirConciliacion: vi.fn(async () => ({ status: "ok" as const, cierreBodegaId: CB })),
    ...overrides,
  } as unknown as IConciliacionSatelitesService & Record<string, ReturnType<typeof vi.fn>>;
}

const conActor = (actor: Actor | null) => ({ getActor: async () => actor });

/** Lee las llamadas de un doble que viaja tipado como el metodo de la interfaz (ver el servicio). */
function llamadasDe(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

describe("431/T8 — el borde: sin sesion", () => {
  it("⭑ sin sesion, las cuatro acciones devuelven `unauthenticated` y NO tocan el servicio", async () => {
    const service = fakeService();
    const deps = { service, ...conActor(null) };

    expect((await listarSaldosSatelitesAction({}, deps)).status).toBe("unauthenticated");
    expect(
      (await listarConsolidacionesSateliteAction({ zonaId: ZONA }, deps)).status,
    ).toBe("unauthenticated");
    expect(
      (
        await marcarConsolidacionRecibidaAction(
          { cierreBodegaId: CB, montoRecibido: "485.00" },
          deps,
        )
      ).status,
    ).toBe("unauthenticated");
    expect((await revertirConciliacionAction({ cierreBodegaId: CB }, deps)).status).toBe(
      "unauthenticated",
    );

    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("431/T8 (R10) — el monto muere en el borde, y no se escribe nada", () => {
  it.each([
    ["ausente", {}],
    ["cadena vacia", { montoRecibido: "" }],
    ["negativo", { montoRecibido: "-1.00" }],
    ["cero", { montoRecibido: "0" }],
    ["con TRES decimales", { montoRecibido: "485.123" }],
    ["no numerico", { montoRecibido: "mucho" }],
    ["un number y no un string", { montoRecibido: 485 }],
  ])("⭑ monto %s -> `validation_error` y el servicio NI SE LLAMA", async (_n, parche) => {
    const service = fakeService();
    const r = await marcarConsolidacionRecibidaAction(
      { cierreBodegaId: CB, ...parche },
      { service, ...conActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    // R10: «NO DEBE escribir nada». Esto es lo que lo afirma.
    expect(service.marcarRecibida).not.toHaveBeenCalled();
  });

  it("⭑ el CERO se rechaza a proposito: «recibi ₡0» no es una marca, es no marcar", async () => {
    // Se reusa `montoPositivoSchema` TAL CUAL (> 0) en vez de relajarlo aqui. Si el humano quiere
    // admitir el 0, se cambia la pieza COMPARTIDA y se enteran sus otros consumidores — que es el
    // punto. Reescribir «cuanto dinero es valido» en esta ficha seria la segunda definicion que un
    // dia diverge (leccion de la ficha 381).
    const service = fakeService();
    const r = await marcarConsolidacionRecibidaAction(
      { cierreBodegaId: CB, montoRecibido: "0.00" },
      { service, ...conActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
  });

  it("un monto VALIDO pasa, con y sin nota", async () => {
    // Control positivo: sin el, un schema que lo rechazara todo pasaria los casos de arriba.
    const service = fakeService();
    const deps = { service, ...conActor(MAESTRO) };

    expect(
      (
        await marcarConsolidacionRecibidaAction(
          { cierreBodegaId: CB, montoRecibido: "485.00" },
          deps,
        )
      ).status,
    ).toBe("ok");
    expect(
      (
        await marcarConsolidacionRecibidaAction(
          { cierreBodegaId: CB, montoRecibido: "485", nota: "faltaron 15" },
          deps,
        )
      ).status,
    ).toBe("ok");
    expect(service.marcarRecibida).toHaveBeenCalledTimes(2);
  });

  it("⭑ `.strict()`: una clave colada muere en el borde", async () => {
    // Lo que esto impide de verdad: que alguien mande `actorUsuarioId` o `estado` en el payload y
    // el borde se lo pase al servicio. Quien marca sale de la SESION, siempre.
    const service = fakeService();
    const r = await marcarConsolidacionRecibidaAction(
      { cierreBodegaId: CB, montoRecibido: "485.00", actorUsuarioId: "otro" },
      { service, ...conActor(MAESTRO) },
    );

    expect(r.status).toBe("validation_error");
    expect(service.marcarRecibida).not.toHaveBeenCalled();
  });

  it("un `cierreBodegaId` que no es uuid muere en el borde", async () => {
    const service = fakeService();
    const r = await revertirConciliacionAction(
      { cierreBodegaId: "no-soy-un-uuid" },
      { service, ...conActor(MAESTRO) },
    );
    expect(r.status).toBe("validation_error");
    expect(service.revertirConciliacion).not.toHaveBeenCalled();
  });
});

describe("431/T8 — el borde transporta lo que el servicio decide, sin reinterpretarlo", () => {
  it("`forbidden` del servicio llega tal cual (el rol es dominio, no transporte)", async () => {
    const service = fakeService({
      marcarRecibida: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await marcarConsolidacionRecibidaAction(
      { cierreBodegaId: CB, montoRecibido: "485.00" },
      { service, ...conActor(MAESTRO) },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("`conflict` y `no_encontrada` llegan tal cual", async () => {
    const enConflicto = fakeService({
      marcarRecibida: vi.fn(async () => ({ status: "conflict" as const })),
    });
    expect(
      await marcarConsolidacionRecibidaAction(
        { cierreBodegaId: CB, montoRecibido: "1.00" },
        { service: enConflicto, ...conActor(MAESTRO) },
      ),
    ).toEqual({ status: "conflict" });

    const inexistente = fakeService({
      revertirConciliacion: vi.fn(async () => ({ status: "no_encontrada" as const })),
    });
    expect(
      await revertirConciliacionAction(
        { cierreBodegaId: CB },
        { service: inexistente, ...conActor(MAESTRO) },
      ),
    ).toEqual({ status: "no_encontrada" });
  });

  it("el listado aplica los valores por defecto de paginacion del dominio", async () => {
    const service = fakeService();
    await listarSaldosSatelitesAction({}, { service, ...conActor(MAESTRO) });
    const input = llamadasDe(service.listarSaldosSatelites)[0][0] as {
      page: number;
      pageSize: number;
    };
    expect(input.page).toBe(1);
    expect(input.pageSize).toBeGreaterThan(0);
  });
});
