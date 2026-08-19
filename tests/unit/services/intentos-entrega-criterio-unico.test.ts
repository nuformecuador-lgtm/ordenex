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
  prismaGestionSobreFilas,
  type FilaGestionFake,
} from "@/tests/fixtures/intentos-entrega";
import { ingresoBodegaPorResultado } from "@/lib/utils/ingreso-bodega";

// Feature 215 (R6) — CRITERIO UNICO: el cron SLA (99), el drawer de historial (47) y el conteo
// EN LOTE de las superficies tienen que producir EL MISMO numero para la misma orden.
//
// Este test NO mockea el conteo: monta el repositorio REAL sobre un doble de Prisma que evalua
// el predicado contra filas de `gestion_orden` de ejemplo. Si alguien introdujera una segunda
// definicion de "intento" —una para la UI y otra para el dinero—, aqui se ve.
//
// Lo que cambio con la 215: los escenarios se expresan en clave de CIERRES. El intento ya no se
// gana al registrar la gestion, se gana cuando el admin APRUEBA el cierre que la agrupa.

const NOW = new Date("2026-07-20T12:00:00.000Z");
const HORA = 60 * 60 * 1000;

const ID_DEVUELTA = "os-devuelta";
const ESTATUS: Record<string, string> = {
  devuelta: ID_DEVUELTA,
  reprogramada: "os-reprogramada",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

const ORDEN = "o1";

// --- Filas de `gestion_orden` de la orden ----------------------------------------------------

/**
 * Gestion contable de la orden, en el cierre `cierreId` con estado `cierreEstado`. Por defecto
 * nace de una VISITA REAL del mensajero (`origen_tipo = 'gestion'`, feature 215/T21): los casos
 * de las gestiones SINTETICAS lo sobrescriben con su familia real.
 */
function gestion(
  resultado: string,
  cierreId: string | null,
  cierreEstado: string | null = "aprobado",
  over: Partial<FilaGestionFake> = {},
): FilaGestionFake {
  return {
    ordenId: ORDEN,
    resultado,
    anuladaAt: null,
    cierreId,
    cierreEstado,
    origenTiposHistorial: ["gestion"],
    ...over,
  };
}

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

function montar(filas: FilaGestionFake[]) {
  const prisma = prismaGestionSobreFilas(filas);
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
    // 2026-08-19 (feature 239/T3.3): el DTO gana `origenAncla`, obligatorio a proposito para que
    // ningun productor pueda dejar la rama del ancla sin decir cual es. Es un campo mas del
    // objeto, NO un cambio del criterio de intento — este archivo sigue midiendo lo mismo.
    origenAncla: "aprobacion",
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

describe("R6 — el cron SLA, el drawer y el lote ven EL MISMO numero", () => {
  it.each([
    {
      caso: "2 cierres APROBADOS con `devuelta`",
      filas: [gestion("devuelta", "c1"), gestion("devuelta", "c2")],
      esperado: 2,
    },
    {
      caso: "1 `devuelta` + 2 `reprogramada` en 3 cierres aprobados",
      filas: [
        gestion("devuelta", "c1"),
        gestion("reprogramada", "c2"),
        gestion("reprogramada", "c3"),
      ],
      esperado: 3,
    },
    {
      caso: "las mismas 3 gestiones con los cierres en `solicitado`",
      filas: [
        gestion("devuelta", "c1", "solicitado"),
        gestion("reprogramada", "c2", "solicitado"),
        gestion("reprogramada", "c3", "solicitado"),
      ],
      esperado: 0,
    },
    {
      caso: "R29: 2 gestiones vigentes en el MISMO cierre aprobado",
      filas: [gestion("devuelta", "c1"), gestion("reprogramada", "c1")],
      esperado: 1,
    },
    { caso: "orden sin gestiones", filas: [], esperado: 0 },
  ])("$caso -> $esperado, identico en drawer, cron y lote", async ({ filas, esperado }) => {
    const { service } = montar(filas);

    // (1) el drawer de historial (feature 47)
    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");

    // (2) el numero que consume el cron SLA (feature 99) — el mismo metodo, el mismo criterio
    const delCron = await service.contarIntentos(ORDEN);

    // (3) el conteo EN LOTE que alimenta las superficies
    const lote = await service.contarIntentosEnLote([ORDEN]);

    expect(drawer.intentos).toBe(esperado);
    expect(delCron).toBe(esperado);
    expect(lote.get(ORDEN) ?? 0).toBe(esperado); // R8: sin filas -> 0, no ausencia
    // La afirmacion que importa: los tres son EL MISMO numero.
    expect(new Set([drawer.intentos, delCron, lote.get(ORDEN) ?? 0]).size).toBe(1);
  });

  // El desenlace de dinero, extremo a extremo: 3 cierres APROBADOS con resultado contable ->
  // el drawer muestra 3 y el cron ESCALA a `rechazada` (lo que dispara `cobroRechazado`, 56).
  it("R15: 1 devuelta + 2 reprogramadas en 3 cierres APROBADOS -> drawer 3 y el cron ESCALA", async () => {
    const { service, ordenRepo } = montar([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2"),
      gestion("reprogramada", "c3"),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(reintentosConfig.MIN_INTENTOS_ENTREGA); // 3 >= umbral 3
    expect(drawer.umbral).toBe(reintentosConfig.MIN_INTENTOS_ENTREGA);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0, legadas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
  });

  // ⛔ Q5, ABIERTA Y SIN MITIGACION — DOCUMENTADO A PROPOSITO, NO TAPADO.
  //
  // Las MISMAS tres gestiones, pero con sus cierres en `solicitado`: el conteo es 0 y el cron
  // LIBERA la orden a bodega. Si esos cierres nunca llegan a `aprobado` —el admin no los
  // resuelve, el mensajero se desvincula, el `vencido` no se re-solicita— la orden se queda en
  // 0 PARA SIEMPRE: sale, se devuelve, el cron la libera, y otra vez, en bucle operativo. Nunca
  // escala, nunca se rechaza y el `cobroRechazado` (56) NUNCA se emite.
  //
  // Este test AFIRMA ese comportamiento porque es el que la feature tiene hoy, no porque sea
  // deseable. Las tres mitigaciones posibles estan medidas en `design.md §7bis` (M1/M2/M3) y
  // NINGUNA se implementa: Q5 sigue abierta y es decision del humano.
  it("Q5 (ABIERTA): con los cierres en `solicitado` el conteo es 0 y el cron LIBERA en bucle", async () => {
    const { service, ordenRepo } = montar([
      gestion("devuelta", "c1", "solicitado"),
      gestion("reprogramada", "c2", "solicitado"),
      gestion("reprogramada", "c3", "solicitado"),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(0);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0, legadas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R29 (D9): el grano es la ORDEN dentro del cierre. Dos gestiones vigentes contables en el
  // MISMO cierre aprobado suman 1. Si sumaran 2, el cron escalaria antes de tiempo y se cobraria
  // el rechazo a la tienda de mas.
  it("R29: 2 gestiones vigentes en el MISMO cierre aprobado -> 1, y el cron LIBERA", async () => {
    const { service, ordenRepo } = montar([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c1"),
    ]);

    const drawer = await service.obtenerHistorial(ORDEN, MAESTRO);
    if (drawer.status !== "ok") throw new Error("esperaba ok");
    expect(drawer.intentos).toBe(1);
    expect(await service.contarIntentos(ORDEN)).toBe(1);

    const { repo, svc } = cron(service, ordenRepo);
    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0, legadas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // Feature 215 (T21, R18-a/b/c/d + R34) — LAS DOS MITADES DEL ESCALADO, EN EL MISMO ESCENARIO.
  // [💰]
  //
  // La gestion sintetica que el cron crea al escalar (`DevolucionSlaRepository.escalarDevueltaSla`,
  // `resultado: rechazada`, historial `escalado_devuelta_sla`) nace con `cierre_id: null` y con el
  // `mensajero_id` de la ultima `devuelta` vigente, asi que acaba dentro del siguiente cierre de
  // ese mensajero y ese cierre se aprueba. A partir de ahi hay DOS caminos independientes y esta
  // feature solo toca el primero:
  //   - INTENTO: la sintetica NO suma (R18-a/b). Si sumara, la orden pasaria de 3 a 4 por un
  //     escalado que ella misma provoco — el conteo se auto-alimentaria.
  //   - RECHAZO: la sintetica SIGUE cobrando (R18-d/R17). El ingreso de bodega se deriva del
  //     `resultado` en `ingresoBodegaPorResultado` (`lib/utils/ingreso-bodega.ts`), una funcion
  //     PURA que no consulta el conteo de intentos ni lo recibe. Por eso
  //     `devolucion-sla-dinero.test.ts` sigue verde sin tocarse.
  it("R18-a/b/c/d: la sintetica del cron NO suma como INTENTO pero SI cobra como RECHAZO", async () => {
    const visitasReales: FilaGestionFake[] = [
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2"),
      gestion("devuelta", "c3"),
    ];

    // (1) R18-c: el cron sigue comparando el conteo contra el umbral ANTES de escalar. 3 visitas
    // reales en 3 cierres aprobados = 3 >= umbral 3 -> escala. La condicion NO cambia.
    const antes = montar(visitasReales);
    expect(await antes.service.contarIntentos(ORDEN)).toBe(
      reintentosConfig.MIN_INTENTOS_ENTREGA,
    );
    const { repo, svc } = cron(antes.service, antes.ordenRepo);
    expect(await svc.ejecutar(NOW)).toEqual({
      evaluadas: 0,
      liberadas: 0,
      escaladas: 1,
      omitidas: 0,
      legadas: 0, // feature 239 (T3.3): quinto conteo del resumen, no cambia el criterio
    });
    expect(repo.escalarDevueltaSla).toHaveBeenCalledTimes(1);

    // (2) R18-a/b: el mundo DESPUES del escalado — la sintetica ya existe, cayo en el cierre `c4`
    // del mensajero y ese cierre se APROBO. El conteo sigue siendo 3, no 4.
    const sintetica = gestion("rechazada", "c4", "aprobado", {
      origenTiposHistorial: ["escalado_devuelta_sla"],
    });
    const despues = montar([...visitasReales, sintetica]);
    expect(await despues.service.contarIntentos(ORDEN)).toBe(3);
    expect((await despues.service.contarIntentosEnLote([ORDEN])).get(ORDEN) ?? 0).toBe(3);

    // (3) R18-d/R17: y esa MISMA gestion sintetica sigue cobrando el rechazo. El monto sale del
    // `resultado` y de la tarifa; el conteo de intentos no entra en la formula por ningun lado.
    const tarifa = { cobroEntregado: "2.00", cobroRechazado: "1.50" };
    expect(ingresoBodegaPorResultado("rechazada", tarifa)).toBe("1.50");
    // Y no cobra por lo que no es un rechazo: las visitas reales que si contaron aportan 0.00.
    expect(ingresoBodegaPorResultado("devuelta", tarifa)).toBe("0.00");
    expect(ingresoBodegaPorResultado("reprogramada", tarifa)).toBe("0.00");
  });

  // R7: el lote no es una comodidad, es un requisito. Con N ordenes se emite UNA consulta.
  it("R7: el lote de N ordenes emite UNA sola consulta", async () => {
    const otras: FilaGestionFake[] = [
      { ...gestion("devuelta", "c1"), ordenId: "o2" },
      { ...gestion("reprogramada", "c2"), ordenId: "o3" },
      { ...gestion("entregada", "c3"), ordenId: "o4" },
    ];
    const { service, prisma } = montar([gestion("devuelta", "c0"), ...otras]);

    const mapa = await service.contarIntentosEnLote([ORDEN, "o2", "o3", "o4", "o5"]);

    expect(prisma.gestionOrden.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.gestionOrden.count).not.toHaveBeenCalled();
    expect(mapa.get(ORDEN)).toBe(1);
    expect(mapa.get("o2")).toBe(1);
    expect(mapa.get("o3")).toBe(1);
    expect(mapa.get("o4")).toBeUndefined(); // `entregada` no cuenta (R2) -> `?? 0`
    expect(mapa.get("o5")).toBeUndefined(); // sin gestiones -> `?? 0`
  });
});
