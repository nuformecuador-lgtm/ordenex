import { describe, it, expect, vi, afterEach } from "vitest";

import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { NovedadesService } from "@/lib/services/NovedadesService";
import { reintentosConfig } from "@/lib/config/reintentos";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenRepository, NovedadOrdenRow } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

/**
 * FEATURE 273 (T11/T12, mitad de SERVIDOR) — `enElTope` VIAJA YA DECIDIDO. R8, R10.
 *
 * ⚠️ QUE CUBRE ESTE ARCHIVO Y QUE NO. Cubre la mitad que vive en el servidor: que los DOS DTO que
 * alimentan las dos superficies emitan la DECISION —un booleano— y que el UMBRAL no cruce al
 * cliente. Lo que hacen los componentes con ese booleano (dejar de pintar «Reprogramar» y
 * «Devolver», y explicar por que) es la mitad de frontend, y tiene sus propios tests.
 *
 * POR QUE UN BOOLEANO Y NO EL NUMERO (R10): si viajara el umbral, la pantalla tendria que
 * compararlo, y esa comparacion seria una SEGUNDA definicion de la regla que puede divergir de la
 * del servidor. Con el booleano, la unica forma de que la UI y la guarda discrepen es que alguien
 * cambie el servidor — y entonces cambian las dos a la vez.
 *
 * Y NO SUSTITUYE A LA GUARDA (R11): el filtro de botones es cortesia; el rechazo del servidor es
 * la seguridad. Eso se mide en `mis-asignaciones-tope-intentos` y `gestion-desde-ayuda-tope-intentos`.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const TIENDA: Actor = { usuarioId: "t1", rol: "adminTienda" };
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

/* -------------------------------------------------------------------------- */
/* El panel del mensajero                                                      */
/* -------------------------------------------------------------------------- */

function filaAsignacion(over: Partial<MiAsignacionRow> & { id: string }): MiAsignacionRow {
  return {
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    mensajeroAsignadoId: "m1",
    ...over,
  };
}

function repoAsignaciones(rows: MiAsignacionRow[]): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => rows),
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => []),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    crearGestionDesdeAyuda: vi.fn(async () => "g-desde-ayuda"),
    rechazarDesdeDevuelta: vi.fn(async () => true),
  };
}

function panel(rows: MiAsignacionRow[], intentos: Record<string, number>) {
  const service = new MisAsignacionesService(
    repoAsignaciones(rows),
    {
      findEstatusIdByValue: vi.fn(async () => "x"),
      findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
    } as unknown as Pick<IOrdenRepository, "findEstatusIdByValue" | "findBloqueoDetalle">,
    {} as IFileStorage,
    {} as ISignedUrlProvider,
    {
      findByMensajero: vi.fn(async () => null),
      upsertOrigen: vi.fn(async () => {}),
    } as unknown as Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">,
    {
      findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
    } as Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero">,
    fakeIntentosEnLote(intentos),
  );
  return service;
}

describe("273/R8/R10 — `MiAsignacionDTO.enElTope` sale ya decidido del servidor", () => {
  it("`true` en el ultimo intento, `false` por debajo, en la MISMA respuesta", async () => {
    // Las dos ordenes viajan juntas: si el servicio emitiera un valor constante —o se olvidara del
    // campo— este par lo delata, porque tienen que salir DISTINTAS.
    const service = panel(
      [filaAsignacion({ id: "o-tope" }), filaAsignacion({ id: "o-lejos" })],
      { "o-tope": UMBRAL - 1, "o-lejos": UMBRAL - 2 },
    );

    const r = await service.listarMisAsignaciones(MENSAJERO);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const porId = new Map(r.porGestionar.map((d) => [d.id, d]));
    expect(porId.get("o-tope")?.enElTope).toBe(true);
    expect(porId.get("o-lejos")?.enElTope).toBe(false);
    // Y el numero del que se deriva sigue viajando, con su valor: la card lo pinta.
    expect(porId.get("o-tope")?.intentosEntrega).toBe(UMBRAL - 1);
  });

  it("la orden SIN intentos sale con `enElTope: false` EXPLICITO, no ausente", async () => {
    // R14 de la 160 aplicado al campo nuevo: el `false` es un valor CONOCIDO, no un dato que
    // falta. Un `undefined` obligaria a la pantalla a decidir que hacer con la ausencia.
    const service = panel([filaAsignacion({ id: "o1" })], {});

    const r = await service.listarMisAsignaciones(MENSAJERO);

    if (r.status !== "ok") return;
    expect(r.porGestionar[0]).toHaveProperty("enElTope");
    expect(r.porGestionar[0].enElTope).toBe(false);
  });

  it("R10 — el UMBRAL no viaja en el DTO por ninguna via", async () => {
    const service = panel([filaAsignacion({ id: "o1" })], { o1: UMBRAL - 1 });

    const r = await service.listarMisAsignaciones(MENSAJERO);

    if (r.status !== "ok") return;
    const serializado = JSON.stringify(r.porGestionar[0]);
    // Ni con ese nombre ni con ningun otro: el DTO no tiene ninguna clave que lo lleve.
    expect(serializado).not.toContain("umbral");
    expect(serializado).not.toContain("MIN_INTENTOS");
    expect(Object.keys(r.porGestionar[0])).not.toContain("umbral");
  });

  it("R7 — con `REINTENTOS_MIN_INTENTOS = 5` la MISMA orden deja de estar en el tope", async () => {
    // Prueba de que el booleano se DERIVA de la configuracion y no de un `3` escrito a mano: con
    // umbral 3 una orden con 2 intentos esta en el tope; con umbral 5, no.
    const ANTES = process.env.REINTENTOS_MIN_INTENTOS;
    try {
      process.env.REINTENTOS_MIN_INTENTOS = "5";
      vi.resetModules();
      const { MisAsignacionesService: Fresco } = await import(
        "@/lib/services/MisAsignacionesService"
      );
      const service = new Fresco(
        repoAsignaciones([filaAsignacion({ id: "o1" })]),
        {
          findEstatusIdByValue: vi.fn(async () => "x"),
          findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
        } as unknown as Pick<IOrdenRepository, "findEstatusIdByValue" | "findBloqueoDetalle">,
        {} as IFileStorage,
        {} as ISignedUrlProvider,
        {
          findByMensajero: vi.fn(async () => null),
          upsertOrigen: vi.fn(async () => {}),
        } as unknown as Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen">,
        {
          findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()),
        } as Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero">,
        fakeIntentosEnLote({ o1: 2 }),
      );

      const r = await service.listarMisAsignaciones(MENSAJERO);

      if (r.status !== "ok") return;
      expect(r.porGestionar[0].enElTope).toBe(false); // 2 < 5 - 1
    } finally {
      if (ANTES === undefined) delete process.env.REINTENTOS_MIN_INTENTOS;
      else process.env.REINTENTOS_MIN_INTENTOS = ANTES;
      vi.resetModules();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* La pestaña de ayuda de la tienda                                            */
/* -------------------------------------------------------------------------- */

function filaNovedad(over: Partial<NovedadOrdenRow> & { id: string }): NovedadOrdenRow {
  return {
    numGuia: 1,
    numRemision: "R-1",
    estatusValue: "ayuda_tienda",
    destinatario: "Ana",
    telefonoDest: "099",
    direccion: "calle",
    producto: "caja",
    peso: null,
    montoCobrar: 100,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "T",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: "D",
    mensajeroAsignadoId: "m1",
    intentosContacto: 0,
    createdAt: new Date("2026-08-20T10:00:00.000Z"),
    ...over,
  } as NovedadOrdenRow;
}

describe("273/R8/R10 — `NovedadDTO.enElTope` sale ya decidido del servidor", () => {
  it("`true` en el ultimo intento y `false` por debajo, en la misma pagina", async () => {
    const rows = [filaNovedad({ id: "n-tope" }), filaNovedad({ id: "n-lejos" })];
    const ordenRepo = {
      countNovedadesByTienda: vi.fn(async () => rows.length),
      findNovedadesByTienda: vi.fn(async () => rows),
      findCausasDevueltaVigentes: vi.fn(async () => new Map()),
      findFechaSolicitudAyuda: vi.fn(async () => new Map()),
    } as unknown as IOrdenRepository;
    const service = new NovedadesService(
      ordenRepo,
      fakeIntentosEnLote({ "n-tope": UMBRAL - 1, "n-lejos": 0 }),
    );

    const r = await service.listar({ page: 1, pageSize: 20, grupo: "ayuda" }, TIENDA);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const porId = new Map(r.items.map((d) => [d.id, d]));
    expect(porId.get("n-tope")?.enElTope).toBe(true);
    expect(porId.get("n-lejos")?.enElTope).toBe(false);
  });
});
