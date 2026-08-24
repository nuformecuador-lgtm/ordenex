import { describe, expect, it, vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { OrdenParaHilo } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { GestionDesdeAyudaInput } from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { GestionDesdeAyudaService } from "@/lib/services/GestionDesdeAyudaService";
// ⭑ EL MISMO SIMBOLO que importa el test del panel del mensajero, no un literal gemelo. R4 exige
// que la regla valga IGUAL en las dos superficies, y R6 que el motivo sea el mismo: si alguien
// escribiera un texto propio en uno de los dos servicios, este import lo delata.
import { MSG_TOPE_INTENTOS_GESTION } from "@/lib/services/mensajes-bloqueo";
import { reintentosConfig } from "@/lib/config/reintentos";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

/**
 * FEATURE 273 (T5) — LA PUERTA DEL TOPE EN LA PESTAÑA DE AYUDA DE LA TIENDA. R1, R4, R5, R6, R11.
 *
 * 💰 Es la operacion mas delicada en dinero de la pila de la ayuda: un `rechazada` dispara el
 * `cobroRechazado` (56) y el flete de devolucion. Lo que esta puerta añade es que una orden que ya
 * agoto sus intentos no se pueda REPROGRAMAR desde aqui — porque reprogramar la devolveria a
 * circulacion por la tercera puerta.
 *
 * CONSECUENCIA que se afirma explicitamente abajo: desde la ayuda solo hay dos desenlaces, asi que
 * en el tope a la tienda le queda SOLO `rechazada`.
 */

const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };

/** El umbral REAL. Ningun caso escribe `3`. */
const UMBRAL = reintentosConfig.MIN_INTENTOS_ENTREGA;

const CATALOGO: Record<string, string> = {
  ayuda_tienda: "os-ayuda",
  reprogramada: "os-reprogramada",
  rechazada: "os-rechazada",
};

function ordenParaHilo(over: Partial<OrdenParaHilo> = {}): OrdenParaHilo {
  return {
    tiendaId: "tienda-1",
    mensajeroAsignadoId: "mensajero-1",
    estatusValue: "ayuda_tienda",
    deletedAt: null,
    fechaReparto: null,
    ...over,
  };
}

function fakeStorage(): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
}

function montar(intentos: number) {
  const notaRepo = { findOrdenParaHilo: vi.fn(async () => ordenParaHilo()) };
  const ordenRepo = { findEstatusIdByValue: vi.fn(async (v: string) => CATALOGO[v] ?? null) };
  const gestionRepo = { crearGestionDesdeAyuda: vi.fn(async () => "g-ayuda") };
  const storage = fakeStorage();
  const historial = fakeIntentosEnLote({ o1: intentos });
  const service = new GestionDesdeAyudaService({
    notaRepo,
    ordenRepo,
    gestionRepo,
    storage,
    historial,
  });
  return { service, notaRepo, ordenRepo, gestionRepo, storage, historial };
}

function foto(n: number) {
  return { contentType: "image/jpeg" as const, bytes: new Uint8Array([n]) };
}

const REPROGRAMACION: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "reprogramada",
  fechaReprogramacion: "2027-01-05",
  motivo: "el cliente pidio otro dia",
  evidencias: [foto(0)],
};

const RECHAZO: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "rechazada",
  motivo: "el cliente no la quiere",
  evidencias: [foto(0), foto(1)],
};

/* -------------------------------------------------------------------------- */
/* 1 · La regla, y que es LA MISMA que la del mensajero                        */
/* -------------------------------------------------------------------------- */

describe("273/T5 · R1/R4 — la tienda tampoco reprograma en el tope", () => {
  it("1a. `reprogramada` con `intentos = umbral - 1` -> conflict con el MISMO motivo", async () => {
    const { service, gestionRepo } = montar(UMBRAL - 1);

    const r = await service.gestionar(REPROGRAMACION, TIENDA);

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });

  it("1b. `rechazada` en el tope SIGUE pasando: es el unico desenlace que le queda", async () => {
    // Esto es lo que hace que la puerta no deje a la tienda sin salida. Desde la ayuda hay dos
    // desenlaces y `incidente` no tiene productor por esta via (237): en el tope queda `rechazada`.
    const { service, gestionRepo } = montar(UMBRAL - 1);

    const r = await service.gestionar(RECHAZO, TIENDA);

    expect(r).toEqual({ status: "ok", ordenId: "o1", resultado: "rechazada" });
    expect(gestionRepo.crearGestionDesdeAyuda).toHaveBeenCalledTimes(1);
  });

  it("1c. con `intentos = umbral - 2` reprogramar pasa (la puerta no se cierra antes)", async () => {
    const { service, gestionRepo } = montar(UMBRAL - 2);

    const r = await service.gestionar(REPROGRAMACION, TIENDA);

    expect(r).toEqual({ status: "ok", ordenId: "o1", resultado: "reprogramada" });
    expect(gestionRepo.crearGestionDesdeAyuda).toHaveBeenCalledTimes(1);
  });

  it("1d. con `intentos` POR ENCIMA del umbral sigue bloqueada", async () => {
    const { service, gestionRepo } = montar(UMBRAL + 2);

    const r = await service.gestionar(REPROGRAMACION, TIENDA);

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · R5 — el caso de NO-EFECTO                                               */
/* -------------------------------------------------------------------------- */

describe("273/T5 · R5 — el rechazo no deja fotos huerfanas ni fila de gestion", () => {
  it("2. cero subidas y cero llamadas a `crearGestionDesdeAyuda`", async () => {
    // La reprogramacion desde ayuda SI sube evidencia. Si la guarda viviera por debajo del paso 7,
    // este doble habria recibido la foto: quedaria en el bucket apuntando a una gestion inexistente.
    const { service, storage, gestionRepo } = montar(UMBRAL - 1);

    const r = await service.gestionar(
      { ...REPROGRAMACION, evidencias: [foto(0), foto(1), foto(2)] },
      TIENDA,
    );

    expect(r.status).toBe("conflict");
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled(); // no hubo nada que compensar
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });

  it("2.bis — la guarda va DESPUES del catalogo? No: ni siquiera se resuelven los estatus", async () => {
    // El paso 6 (catalogo) viene por debajo de la puerta. Que `findEstatusIdByValue` no se llame
    // demuestra el ORDEN, no solo el resultado.
    const { service, ordenRepo } = montar(UMBRAL - 1);

    await service.gestionar(REPROGRAMACION, TIENDA);

    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });

  it("2.ter — con un resultado PERMITIDO no se consulta el contador (R2, sin condicion nueva)", async () => {
    const { service, historial } = montar(UMBRAL + 9);

    await service.gestionar(RECHAZO, TIENDA);

    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · R11 — el servidor decide, no el cliente                                 */
/* -------------------------------------------------------------------------- */

describe("273/T5 · R11 — no hay campo del input que abra la puerta", () => {
  it("3. el input llega completo, como lo mandaria un cliente que ignore la ventana", async () => {
    const { service, gestionRepo, storage } = montar(UMBRAL - 1);

    const r = await service.gestionar(
      {
        ordenId: "o1",
        resultado: "reprogramada",
        fechaReprogramacion: "2027-12-31",
        motivo: "insistir la semana que viene",
        evidencias: [foto(7)],
      },
      TIENDA,
    );

    expect(r).toEqual({ status: "conflict", motivo: MSG_TOPE_INTENTOS_GESTION });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });

  it("3.bis — las guardas previas siguen ganando: fuera de ayuda no se llega al tope", async () => {
    // Si el orden se invirtiera, una orden que ya salio de ayuda leeria el motivo del tope en vez
    // del suyo, y la tienda no sabria que paso.
    const notaRepo = {
      findOrdenParaHilo: vi.fn(async () => ordenParaHilo({ estatusValue: "en_reparto" })),
    };
    const historial = fakeIntentosEnLote({ o1: UMBRAL + 1 });
    const service = new GestionDesdeAyudaService({
      notaRepo,
      ordenRepo: { findEstatusIdByValue: vi.fn(async (v: string) => CATALOGO[v] ?? null) },
      gestionRepo: { crearGestionDesdeAyuda: vi.fn(async () => "g") },
      storage: fakeStorage(),
      historial,
    });

    const r = await service.gestionar(REPROGRAMACION, TIENDA);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.motivo).not.toBe(MSG_TOPE_INTENTOS_GESTION);
    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });
});
