import { describe, expect, it, vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { OrdenParaHilo } from "@/lib/interfaces/repositories/IOrdenNotaRepository";
import type { GestionDesdeAyudaInput } from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  GestionDesdeAyudaService,
  MENSAJES_GESTION_DESDE_AYUDA,
} from "@/lib/services/GestionDesdeAyudaService";
import { avisoReservaParaOtroDia } from "@/lib/utils/dia-reparto-textos";

/**
 * FEATURE 261 (B18, seccion G) — LA TIENDA TAMPOCO RESUELVE EL DIA QUE NO ES. R28-R32.
 *
 * DECISION HUMANA P2 (2026-08-22), y su razonamiento en una linea: *si el problema es que se
 * registre un resultado en un dia que no es, da igual quien lo registre*. La orden llega a
 * `ayuda_tienda` CONSERVANDO su dia de reparto (pedir ayuda no lo toca, 235/R6), asi que es el
 * mismo defecto por otra puerta y con otro actor.
 *
 * ⚠️ POR QUE UNA PUERTA PROPIA Y NO REUSAR `MisAsignacionesService.gestionar` (design A11): aquel
 * metodo existe con cuatro candados que esta via no puede pasar —rol `mensajero`, `estaBloqueado`,
 * origen `en_reparto` y `mensajeroId = actor.usuarioId`— y su cabecera advierte que añadirle «un
 * modo o un actor suplantado a un metodo money-critical deja los cuatro candados a un `if` de
 * abrirse». La puerta va donde la operacion vive.
 *
 * ⚠️ QUE NO PRUEBA ESTE ARCHIVO: el `where` del `updateMany` (R30). Con dobles, quitarle el `OR`
 * del dia no rompe nada. Eso vive en
 * `tests/integration/db/gestion-desde-ayuda-dia-reserva.int.test.ts`, contra Postgres real.
 */

const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };

/** 22:30 CR del 21 = 04:30Z del 22: el dia UTC y el dia CR NO coinciden a proposito. */
const NOCHE_DEL_21 = new Date("2026-08-22T04:30:00.000Z");
/** El mismo reloj, un dia despues: el bloqueo caduca solo. */
const NOCHE_DEL_22 = new Date("2026-08-23T04:30:00.000Z");

const DIA_21 = new Date("2026-08-21T00:00:00.000Z");
const DIA_22 = new Date("2026-08-22T00:00:00.000Z");

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

const CATALOGO: Record<string, string> = {
  ayuda_tienda: "os-ayuda",
  reprogramada: "os-reprogramada",
  rechazada: "os-rechazada",
  devolucion_por_confirmar: "os-devolucion-por-confirmar",
};

function montar(opts: { orden?: OrdenParaHilo; crearDevuelve?: string | null } = {}) {
  const storage: IFileStorage = {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
  const notaRepo = {
    findOrdenParaHilo: vi.fn(async () => opts.orden ?? ordenParaHilo()),
  };
  const ordenRepo = { findEstatusIdByValue: vi.fn(async (v: string) => CATALOGO[v] ?? null) };
  const gestionRepo = {
    crearGestionDesdeAyuda: vi.fn(async () =>
      opts.crearDevuelve === undefined ? "g-ayuda" : opts.crearDevuelve,
    ),
  };
  const service = new GestionDesdeAyudaService({ notaRepo, ordenRepo, gestionRepo, storage });
  return { service, notaRepo, ordenRepo, gestionRepo, storage };
}

const RECHAZO: GestionDesdeAyudaInput = {
  ordenId: "o1",
  resultado: "rechazada",
  motivo: "el cliente no la quiere",
  evidencias: [
    { contentType: "image/jpeg", bytes: new Uint8Array([0]) },
    { contentType: "image/png", bytes: new Uint8Array([1]) },
  ],
};

describe("R28 — la tienda no resuelve una orden reservada para otro dia", () => {
  it("devuelve `conflict`, no `forbidden`: la orden SI es suya, lo que falla es el momento", async () => {
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });

    const r = await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    expect(r.status).toBe("conflict");
  });

  it("R32/R15: el motivo NOMBRA EL DIA y sale de la fuente unica de textos", async () => {
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });

    const r = await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    if (r.status !== "conflict") throw new Error("se esperaba conflict");
    // La MISMA frase que lee la card del mensajero, con la MISMA fecha. Se compara contra la
    // funcion EXPORTADA, no contra una copia del literal: si el servicio reescribiera el texto,
    // la pantalla y el servidor podrian decir cosas distintas (mutacion M-l, por esta via).
    expect(r.motivo).toBe(avisoReservaParaOtroDia("2026-08-22"));
    expect(r.motivo).toBe(MENSAJES_GESTION_DESDE_AYUDA.reservadaParaOtroDia("2026-08-22"));
    // R32: con palabras, con el dia, sin siglas ni nombres de columna.
    expect(r.motivo).toContain("22 de agosto");
    expect(r.motivo).not.toMatch(/fecha_reparto|2026-08-22|SLA/);
  });

  it("y NO se confunde con el rechazo de «ya no esta esperando tu respuesta»", async () => {
    // Un motivo prestado seria un dato falso con formato de dato: la tienda leeria que la orden
    // ya se resolvio cuando lo que pasa es que todavia no es el dia.
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });
    const r = await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);
    if (r.status !== "conflict") throw new Error("se esperaba conflict");
    expect(r.motivo).not.toBe(MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda);
  });
});

describe("⚠️ R29 — el rechazo ocurre ANTES de subir ninguna evidencia", () => {
  it("`storage.upload` NO se llamo, y no hay gestion ni transicion", async () => {
    // ⭑ MUTACION M-n: mover la guarda DEBAJO de `subirEvidenciasCompensadas` deja este caso
    // rojo. El motivo es el que ya escribio el paso 3 del propio servicio: «antes de subir nada,
    // para no dejar fotos huerfanas en el bucket por el camino previsible». Un rechazo
    // PREVISIBLE pertenece antes del upload — subir N fotos para borrarlas acto seguido no es
    // una ineficiencia, es basura en el bucket cada vez que alguien lo intenta.
    const { service, storage, gestionRepo } = montar({
      orden: ordenParaHilo({ fechaReparto: DIA_22 }),
    });

    await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled(); // no hay nada que compensar
    expect(gestionRepo.crearGestionDesdeAyuda).not.toHaveBeenCalled();
  });

  it("tampoco se resuelve el catalogo: la guarda va ANTES del paso 6", async () => {
    // Posicion exacta que pide el design: entre el 5 («sin mensajero») y el 6 (catalogo).
    const { service, ordenRepo } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });

    await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    expect(ordenRepo.findEstatusIdByValue).not.toHaveBeenCalled();
  });
});

describe("R31 — el MISMO criterio y el MISMO dia que la via del mensajero", () => {
  it("reservada para HOY: la tienda SI la resuelve (`>` y no `>=`)", async () => {
    const { service, gestionRepo } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_21 }) });

    const r = await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    expect(r.status).toBe("ok");
    expect(gestionRepo.crearGestionDesdeAyuda).toHaveBeenCalledTimes(1);
  });

  it("sin dia de reparto: se resuelve igual que siempre", async () => {
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: null }) });
    expect((await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21)).status).toBe("ok");
  });

  it("dos `now` distintos sobre la MISMA orden dan dos resultados distintos", async () => {
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });

    expect((await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21)).status).toBe("conflict");
    expect((await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_22)).status).toBe("ok");
  });

  it("el dia se resuelve con el helper de `@db.Date`, no con el dia UTC", async () => {
    // 04:30Z del 22 son las 22:30 CR del 21. Con el dia UTC el servicio compararia contra el 22
    // y la reservada para el 22 pasaria — que es exactamente el defecto medido en produccion.
    const { service } = montar({ orden: ordenParaHilo({ fechaReparto: DIA_22 }) });
    expect((await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21)).status).toBe("conflict");
  });
});

describe("R30 — el dia tambien viaja a la ESCRITURA", () => {
  it("el repositorio recibe `diaEnCurso`, el mismo que decidio la puerta A", async () => {
    const { service, gestionRepo } = montar();

    await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    const arg = (gestionRepo.crearGestionDesdeAyuda as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { diaEnCurso: Date };
    expect(arg.diaEnCurso).toEqual(DIA_21);
  });

  it("si la escritura devuelve `null`, las fotos ya subidas SE RETIRAN", async () => {
    // El camino de compensacion NO es nuevo: ya existia para la carrera «la orden salio de
    // ayuda». R30 lo reutiliza, y este caso afirma que sigue haciendo lo que decia.
    const { service, storage } = montar({ crearDevuelve: null });

    const r = await service.gestionar(RECHAZO, TIENDA, NOCHE_DEL_21);

    expect(r.status).toBe("conflict");
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenCalledTimes(1);
    const retirados = (storage.remove as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(retirados).toHaveLength(2);
  });
});
