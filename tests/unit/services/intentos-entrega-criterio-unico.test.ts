import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  DevueltaSlaRow,
  IDevolucionSlaRepository,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import {
  prismaHistorialSobreFilas,
  type FilaHistorialFake,
} from "@/tests/fixtures/intentos-entrega";

// Feature 160 (R4) — CRITERIO UNICO: el cron SLA (99), el drawer de historial (47) y el conteo
// EN LOTE de las superficies tienen que producir EL MISMO numero para la misma orden.
//
// Este test NO mockea el conteo: monta el repositorio REAL sobre un doble de Prisma que evalua
// el predicado contra filas de historial de ejemplo. Si alguien introdujera una segunda
// definicion de "intento vigente" —una para la UI y otra para el dinero—, aqui se ve.

const NOW = new Date("2026-07-20T12:00:00.000Z");
const HORA = 60 * 60 * 1000;

const ID_DEVUELTA = "os-devuelta";
const ID_REPROGRAMADA = "os-reprogramada";
const ESTATUS: Record<string, string> = {
  devuelta: ID_DEVUELTA,
  reprogramada: ID_REPROGRAMADA,
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

const ORDEN = "o1";

// --- Filas de historial de la orden, una por arista relevante del mapa de la 140 ------------

/** #14 `en_reparto -> devuelta` via `gestion`: la devolucion del mensajero. */
const devuelta = (g: string): FilaHistorialFake => ({
  ordenId: ORDEN,
  estatusDestinoId: ID_DEVUELTA,
  origenTipo: "gestion",
  gestionOrdenId: g,
  gestion: { anuladaAt: null },
});
/** #13 `en_reparto -> reprogramada` via `gestion`: el mensajero fue y no entrego. VISITA real. */
const reprogramadaMensajero = (g: string): FilaHistorialFake => ({
  ordenId: ORDEN,
  estatusDestinoId: ID_REPROGRAMADA,
  origenTipo: "gestion",
  gestionOrdenId: g,
  gestion: { anuladaAt: null },
});
/** #22 `devuelta -> reprogramada` via `reprogramacion_tienda`: tramite de escritorio. */
const reprogramadaTienda = (g: string): FilaHistorialFake => ({
  ordenId: ORDEN,
  estatusDestinoId: ID_REPROGRAMADA,
  origenTipo: "reprogramacion_tienda",
  gestionOrdenId: g,
  gestion: { anuladaAt: null },
});

// --- Wiring: un SOLO OrdenHistorialService sobre el repositorio real ------------------------

function ordenRepoFake(): Pick<
  IOrdenRepository,
  "findById" | "findUsuarioZonaId" | "findEstatusIdByValue"
> {
  return {
    findById: vi.fn(
      async () =>
        ({
          id: ORDEN,
          numGuia: 10,
          numRemision: "R-1",
          estatusId: ID_DEVUELTA,
          destinatario: "Ana",
          telefonoDest: "099",
          tiendaId: "u-tienda",
          zonaId: "z-limon",
          provinciaId: "p1",
          cantonId: "c1",
          distritoId: null,
          producto: "caja",
          peso: null,
          notas: null,
          mensajeroAsignadoId: null,
          createdAt: NOW,
          updatedAt: NOW,
        }) as OrdenDTO,
    ),
    findUsuarioZonaId: vi.fn(async () => "z-limon"),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
  };
}

function montar(filas: FilaHistorialFake[]) {
  const prisma = prismaHistorialSobreFilas(filas);
  const ordenRepo = ordenRepoFake();
  const historialRepo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
  const service = new OrdenHistorialService(
    ordenRepo as unknown as IOrdenRepository,
    historialRepo as unknown as IOrdenHistorialRepository,
  );
  return { prisma, ordenRepo, service };
}

function devueltaSlaRow(): DevueltaSlaRow {
  return {
    ordenId: ORDEN,
    zonaId: "z-limon",
    mensajeroId: "m1",
    causa: "not_found",
    ancladaAt: new Date(NOW.getTime() - 25 * HORA), // ventana de 24h vencida
  };
}

function cron(service: IOrdenHistorialService, ordenRepo: unknown) {
  const repo: IDevolucionSlaRepository = {
    findDevueltasSla: vi.fn(async () => [devueltaSlaRow()]),
    liberarDevueltaSla: vi.fn(async () => true),
    escalarDevueltaSla: vi.fn(async () => true),
  };
  const svc = new DevolucionSlaService(
    repo,
    { findCentralZonaId: vi.fn(async () => "z-central") } as unknown as IZonaRepository,
    ordenRepo as IOrdenRepository,
    service,
    { warn: vi.fn() },
  );
  return { repo, svc };
}

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

// --- Los tests -----------------------------------------------------------------------------

describe("R4 — el cron SLA y el drawer ven EL MISMO numero", () => {
  it.each([
    { caso: "solo devoluciones", filas: [devuelta("g1"), devuelta("g2")], esperado: 2 },
    {
      caso: "devolucion + 2 reprogramaciones del mensajero (#13)",
      filas: [devuelta("g1"), reprogramadaMensajero("g2"), reprogramadaMensajero("g3")],
      esperado: 3,
    },
    {
      caso: "devolucion + reprogramacion de la TIENDA (#22): no hay doble conteo",
      filas: [devuelta("g1"), reprogramadaTienda("g2")],
      esperado: 1,
    },
    { caso: "orden sin historial contable", filas: [], esperado: 0 },
  ])("$caso -> $esperado, identico en drawer, cron y lote", async ({ filas, esperado }) => {
    const { service } = montar(filas);

    // (1) el drawer de historial (feature 47)
    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");

    // (2) el numero que consume el cron SLA (feature 99) — el mismo metodo, el mismo criterio
    const delCron = await service.contarIntentos(ORDEN);

    // (3) el conteo EN LOTE que alimenta las superficies (feature 160)
    const lote = await service.contarIntentosEnLote([ORDEN]);

    expect(drawer.intentos).toBe(esperado);
    expect(delCron).toBe(esperado);
    expect(lote.get(ORDEN) ?? 0).toBe(esperado); // R14: sin filas -> 0, no ausencia
    // La afirmacion que importa: los tres son EL MISMO numero.
    expect(new Set([drawer.intentos, delCron, lote.get(ORDEN) ?? 0]).size).toBe(1);
  });

  // El desenlace de dinero, extremo a extremo: mismo historial -> el drawer muestra 3 y el cron
  // escala a `rechazada` (que es lo que dispara `cobroRechazado` de la 56).
  it("160/R8: con 2 reprogramaciones del mensajero + 1 devuelta, el drawer muestra 3 y el cron ESCALA", async () => {
    const { service, ordenRepo } = montar([
      devuelta("g1"),
      reprogramadaMensajero("g2"),
      reprogramadaMensajero("g3"),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(reintentosConfig.MIN_INTENTOS_ENTREGA); // 3 >= umbral 3
    expect(drawer.umbral).toBe(reintentosConfig.MIN_INTENTOS_ENTREGA);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
  });

  // El contrapunto: la reprogramacion de la TIENDA no cuenta, asi que la MISMA orden con una
  // devolucion y dos reprogramaciones de escritorio NO llega al umbral y se libera. Si esto
  // fallara, se le estaria cobrando un rechazo a la tienda por un tramite suyo.
  it("160/R2: 1 devuelta + 2 reprogramaciones de la TIENDA -> el drawer muestra 1 y el cron LIBERA", async () => {
    const { service, ordenRepo } = montar([
      devuelta("g1"),
      reprogramadaTienda("g2"),
      reprogramadaTienda("g3"),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(1);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // 160/R5: la vigencia aplica a las DOS ramas. Anular las gestiones de reprogramacion baja el
  // conteo y devuelve el desenlace a "liberar" — sin tocar el historial (67/R23).
  it("160/R5: con las reprogramaciones del mensajero ANULADAS, drawer y cron bajan a 1 y LIBERA", async () => {
    const anulada = (f: FilaHistorialFake): FilaHistorialFake => ({
      ...f,
      gestion: { anuladaAt: new Date("2026-07-19T10:00:00.000Z") },
    });
    const { service, ordenRepo } = montar([
      devuelta("g1"),
      anulada(reprogramadaMensajero("g2")),
      anulada(reprogramadaMensajero("g3")),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(1);
    expect(await service.contarIntentos(ORDEN)).toBe(1);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R12: el lote no es una comodidad, es un requisito. Con N ordenes se emite UNA consulta.
  it("R12: el lote de N ordenes emite UNA sola consulta al historial", async () => {
    const otras: FilaHistorialFake[] = [
      { ...devuelta("g1"), ordenId: "o2" },
      { ...reprogramadaMensajero("g2"), ordenId: "o3" },
      { ...reprogramadaTienda("g3"), ordenId: "o4" },
    ];
    const { service, prisma } = montar([devuelta("g0"), ...otras]);

    const mapa = await service.contarIntentosEnLote([ORDEN, "o2", "o3", "o4", "o5"]);

    expect(prisma.ordenHistorialEstado.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.count).not.toHaveBeenCalled();
    expect(mapa.get(ORDEN)).toBe(1);
    expect(mapa.get("o2")).toBe(1);
    expect(mapa.get("o3")).toBe(1); // #13 cuenta
    expect(mapa.get("o4")).toBeUndefined(); // #22 no cuenta -> `?? 0` en el llamador
    expect(mapa.get("o5")).toBeUndefined(); // sin historial -> `?? 0`
  });
});
