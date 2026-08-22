import { describe, it, expect, vi } from "vitest";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type {
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IRutaOptimizadaRepository } from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";
import type { GestionarInput } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { MisAsignacionesService } from "@/lib/services/MisAsignacionesService";
import { RESERVA_MOTIVO_SERVIDOR } from "@/lib/utils/dia-reparto-textos";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

/**
 * FEATURE 261 (B10) — LA RESERVA BLOQUEA TAMBIEN AL MENSAJERO. R1-R10, R15, R27.
 *
 * QUE ES ESTO Y POR QUE EXISTE. Hasta el 2026-08-21 la decision D5 de la feature 246 decia, con
 * todas sus letras, que «la reserva protege del CRON, no del mensajero», apoyada en la medicion
 * M3 («nadie carga la furgoneta despues de las 18:00»). El humano REFUTO M3 usando la app en
 * PRODUCCION: la guia 17496963 se recogio y se gestiono `entregada` a las 22:10 CR del 21
 * estando reservada para el 22. `esParaManana` viajaba al DTO como ETIQUETA y ninguna capa la
 * consultaba para decidir. Este archivo es la parte de la puerta que vive en el SERVICIO.
 *
 * ⚠️ QUE NO PRUEBA ESTE ARCHIVO, y hay que tenerlo delante: los dobles NO VEN EL SQL. Que el
 * `WHERE` de `recogerLote` seleccione de verdad las filas que decimos se prueba contra Postgres
 * real en `tests/integration/db/recoger-lote-dia-reserva.int.test.ts` — medido cuatro veces en
 * este repo: una mutacion del `WHERE` deja once tests de servicio en verde.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

/**
 * 22:30 CR del 21 de agosto = 04:30Z del 22. La hora esta elegida a proposito: el dia UTC y el
 * dia de Costa Rica NO coinciden, asi que un servicio que derivara el dia con el helper
 * equivocado (`inicioDelDiaCREnUtc`, 06:00Z) o en UTC daria el 22 y dejaria de bloquear.
 */
const NOCHE_DEL_21 = new Date("2026-08-22T04:30:00.000Z");
/** El mismo reloj, un dia despues: sirve para probar que el bloqueo CADUCA SOLO (R7). */
const NOCHE_DEL_22 = new Date("2026-08-23T04:30:00.000Z");

const DIA_21 = new Date("2026-08-21T00:00:00.000Z");
const DIA_22 = new Date("2026-08-22T00:00:00.000Z");
const DIA_20 = new Date("2026-08-20T00:00:00.000Z");

const ESTATUS_ID_BY_VALUE: Record<string, string> = {
  por_recoger: "os-espera",
  en_reparto: "os-reparto",
  entregada: "os-entregada",
  reprogramada: "os-reprogramada",
  devolucion_por_confirmar: "os-devolucion-por-confirmar",
  rechazada: "os-rechazada",
  ayuda_tienda: "os-ayuda-tienda",
};

function gestionRow(over: Partial<OrdenGestionRow> = {}): OrdenGestionRow {
  return {
    id: "o1",
    estatusValue: "por_recoger",
    deletedAt: null,
    mensajeroAsignadoId: "m1",
    montoCobrar: 100,
    zonaId: "z1",
    fechaReparto: null,
    ...over,
  };
}

function asignacionRow(over: Partial<MiAsignacionRow> = {}): MiAsignacionRow {
  return {
    id: "o1",
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

function fakeRepo(over: Partial<IGestionOrdenRepository> = {}): IGestionOrdenRepository {
  return {
    findMisAsignaciones: vi.fn(async () => []),
    findMisAsignacionesByIds: vi.fn(async () => []),
    contarEntregadas: vi.fn(async () => 0),
    sumMontoCobrarGestionadas: vi.fn(async () => 0),
    findByIdsParaGestion: vi.fn(async () => [gestionRow()]),
    getOrdenEnGestion: vi.fn(async () => null),
    setOrdenEnGestion: vi.fn(async () => true),
    liberarOrdenEnGestion: vi.fn(async () => true),
    recogerLote: vi.fn(async (ids: string[]) => ids.length),
    crearGestionYTransicionar: vi.fn(async () => "g1"),
    reprogramarDesdeDevuelta: vi.fn(async () => true),
    crearGestionDesdeAyuda: vi.fn(async () => "g-ayuda"),
    rechazarDesdeDevuelta: vi.fn(async () => true),
    ...over,
  };
}

function fakeStorage(): IFileStorage {
  return {
    upload: vi.fn(async (input: { path: string }) => input.path),
    remove: vi.fn(async () => {}),
  };
}

function fakeSignedUrls(): ISignedUrlProvider {
  return {
    createSignedUrl: vi.fn(async (path: string) => `https://signed/${path}`),
    createSignedUrls: vi.fn(async (paths: string[]) =>
      Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
    ),
  };
}

function fakeOrdenRepo(): Pick<
  IOrdenRepository,
  "findEstatusIdByValue" | "findMensajerosBloqueadosParaGestion"
> {
  return {
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_ID_BY_VALUE[v] ?? null),
    findMensajerosBloqueadosParaGestion: vi.fn(async () => new Set<string>()),
  };
}

function fakeRutaRepo(): Pick<IRutaOptimizadaRepository, "findByMensajero" | "upsertOrigen"> {
  return { findByMensajero: vi.fn(async () => null), upsertOrigen: vi.fn(async () => {}) };
}

function fakeMetaRepo(): Pick<IOrdenMensajeroMetaRepository, "findMarcarLuegoByMensajero"> {
  return { findMarcarLuegoByMensajero: vi.fn(async () => new Set<string>()) };
}

function montar(repo: IGestionOrdenRepository = fakeRepo()) {
  const storage = fakeStorage();
  const service = new MisAsignacionesService(
    repo,
    fakeOrdenRepo(),
    storage,
    fakeSignedUrls(),
    fakeRutaRepo(),
    fakeMetaRepo(),
    fakeIntentosEnLote(),
  );
  return { service, repo, storage };
}

const ENTREGA: GestionarInput = {
  ordenId: "o1",
  resultado: "entregada",
  montoRecibido: 100,
  metodoPago: "efectivo",
  pagos: [{ metodo: "efectivo", monto: 100 }],
  evidencias: [{ contentType: "image/jpeg", bytes: new Uint8Array([1]) }],
};

/* -------------------------------------------------------------------------- */
/* R1 · Recoger                                                                */
/* -------------------------------------------------------------------------- */

describe("R1/R4 — recoger una orden reservada para otro dia", () => {
  it("R1: la reservada para MAÑANA se rechaza con `conflict` y su codigo", async () => {
    const { service } = montar(
      fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_22 })]),
      }),
    );

    const r = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    // `conflict` y no `forbidden`: la orden SI es suya; lo que falla es el momento.
    expect(r.detalle).toEqual([
      { ordenId: "o1", motivo: RESERVA_MOTIVO_SERVIDOR, codigo: "reservada_para_otro_dia" },
    ]);
  });

  it("R15: el motivo NO es un literal escrito aqui — sale de la fuente unica de textos", async () => {
    // Si el servicio reescribiera la frase, la card y el servidor podrian decir cosas distintas.
    // Este caso lo ata: se compara contra la constante EXPORTADA, no contra una copia.
    const { service } = montar(
      fakeRepo({
        findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_22 })]),
      }),
    );
    const r = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);
    if (r.status !== "conflict") throw new Error("se esperaba conflict");
    // Y la frase dice de verdad lo que tiene que decir, sin siglas ni nombres de columna.
    expect(r.detalle[0].motivo).toContain("día de reparto posterior");
    expect(r.detalle[0].motivo).not.toMatch(/fecha_reparto|SLA|reserva|corte/i);
  });

  it("R4: el rechazo NO tiene efectos — ni escritura, ni ubicacion, ni puntero", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_22 })]),
    });
    const { service } = montar(repo);

    await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);

    expect(repo.recogerLote).not.toHaveBeenCalled();
    expect(repo.setOrdenEnGestion).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("R4: un lote con UNA reservada aborta ENTERO (ninguna de las otras se recoge)", async () => {
    // El lote es todo-o-nada, como sus guardas hermanas: media recogida dejaria al mensajero sin
    // saber que llevo y que no.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ id: "o1" }),
        gestionRow({ id: "o2", fechaReparto: DIA_22 }),
      ]),
    });
    const { service } = montar(repo);

    const r = await service.recogerAsignaciones(
      { ordenIds: ["o1", "o2"] },
      MENSAJERO,
      NOCHE_DEL_21,
    );

    expect(r.status).toBe("conflict");
    if (r.status !== "conflict") return;
    expect(r.detalle.map((d) => d.ordenId)).toEqual(["o2"]);
    expect(repo.recogerLote).not.toHaveBeenCalled();
  });

  it("R8: `fechaReparto: null` NO bloquea (nada cambia para las ordenes anteriores a la 246)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: null })]),
    });
    const { service } = montar(repo);

    const r = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);

    expect(r.status).toBe("ok");
    expect(repo.recogerLote).toHaveBeenCalledTimes(1);
  });

  it("`>` y NO `>=`: una orden reservada para HOY se recoge — es de hoy, no de otro dia", async () => {
    // Mutacion M-f: cambiar `>` por `>=` en la guarda bloquearia TODO lo reservado, incluido lo
    // de hoy, y dejaria al mensajero sin poder trabajar el dia que le toca.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_21 })]),
    });
    const { service } = montar(repo);

    const r = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);

    expect(r.status).toBe("ok");
    expect(repo.recogerLote).toHaveBeenCalledTimes(1);
  });

  it("una reserva PASADA tampoco bloquea (el dia ya llego y se fue)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_20 })]),
    });
    const { service } = montar(repo);

    expect(
      (await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21)).status,
    ).toBe("ok");
  });

  it("R6/R7: la MISMA fila, con el reloj un dia despues, se recoge — sin escribir nada", async () => {
    // R7 dicho como test: el bloqueo caduca SOLO. La fila no cambia (misma `fechaReparto`), lo
    // unico que se mueve es el reloj. Y R6: el reloj es un parametro, no algo que el servicio
    // vaya a buscar por su cuenta.
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [gestionRow({ fechaReparto: DIA_22 })]),
    });
    const { service } = montar(repo);

    const ayer = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);
    const hoy = await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_22);

    expect(ayer.status).toBe("conflict");
    expect(hoy.status).toBe("ok");
    // Ni una escritura sobre el dia de reparto por el camino: la caducidad es una comparacion.
    expect(repo.recogerLote).toHaveBeenCalledTimes(1); // solo la segunda
  });

  it("R6: el dia que viaja a la ESCRITURA es el de Costa Rica del `now` inyectado", async () => {
    // 04:30Z del 22 son las 22:30 CR del 21. Si el servicio usara el dia UTC, o
    // `inicioDelDiaCREnUtc`, el `WHERE` compararia contra el 22 y la reservada para el 22 se
    // recogeria.
    const repo = fakeRepo({ findByIdsParaGestion: vi.fn(async () => [gestionRow()]) });
    const { service } = montar(repo);

    await service.recogerAsignaciones({ ordenIds: ["o1"] }, MENSAJERO, NOCHE_DEL_21);

    const args = (repo.recogerLote as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[4]).toEqual(DIA_21);
  });
});

/* -------------------------------------------------------------------------- */
/* R3 · Escoger para gestion                                                   */
/* -------------------------------------------------------------------------- */

describe("R3/R4 — escoger para gestion una orden reservada", () => {
  const enRepartoReservada = () =>
    fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: DIA_22 }),
      ]),
    });

  it("R3: `conflict` con el motivo de la fuente unica", async () => {
    const { service } = montar(enRepartoReservada());

    const r = await service.escogerParaGestion("o1", MENSAJERO, NOCHE_DEL_21);

    expect(r).toEqual({ status: "conflict", motivo: RESERVA_MOTIVO_SERVIDOR });
  });

  it("R4: el puntero 1-a-1 NO se toca (rechazar despues lo dejaria puesto)", async () => {
    const repo = enRepartoReservada();
    const { service } = montar(repo);

    await service.escogerParaGestion("o1", MENSAJERO, NOCHE_DEL_21);

    expect(repo.setOrdenEnGestion).not.toHaveBeenCalled();
  });

  it("reservada para HOY: se escoge (`>` y no `>=`)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: DIA_21 }),
      ]),
    });
    const { service } = montar(repo);

    expect(await service.escogerParaGestion("o1", MENSAJERO, NOCHE_DEL_21)).toEqual({
      status: "ok",
      ordenId: "o1",
    });
    expect(repo.setOrdenEnGestion).toHaveBeenCalledTimes(1);
  });

  it("sin dia de reparto: se escoge (R8)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: null }),
      ]),
    });
    const { service } = montar(repo);

    expect((await service.escogerParaGestion("o1", MENSAJERO, NOCHE_DEL_21)).status).toBe("ok");
  });

  it("R7: con el reloj del dia siguiente, la MISMA fila se escoge", async () => {
    const { service } = montar(enRepartoReservada());
    expect((await service.escogerParaGestion("o1", MENSAJERO, NOCHE_DEL_22)).status).toBe("ok");
  });
});

/* -------------------------------------------------------------------------- */
/* R2 · Gestionar                                                              */
/* -------------------------------------------------------------------------- */

describe("R2/R4/R27 — gestionar una orden reservada", () => {
  /**
   * ⭑ R27 — LA POBLACION REAL DEL BLOQUEO DE GESTIONAR. Para gestionar hay que estar en
   * `en_reparto`, y tras esta ficha nadie NUEVO llega ahi estando reservado. O sea que esta
   * guarda alcanza, en regimen, a las ordenes HEREDADAS: las que ya estaban en `en_reparto` con
   * dia futuro al desplegar (medidas contra produccion el 2026-08-21: 2 ordenes, un solo
   * mensajero, ambas para el 22) y a las que un `UPDATE` a mano pueda crear, que ya ocurrio.
   */
  const yaEnReparto = () =>
    fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: DIA_22 }),
      ]),
    });

  it("R2/R27: una orden YA en `en_reparto` con dia futuro no se gestiona", async () => {
    const { service } = montar(yaEnReparto());

    const r = await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_21);

    expect(r).toEqual({ status: "conflict", motivo: RESERVA_MOTIVO_SERVIDOR });
  });

  it("⚠️ R4: el rechazo ocurre ANTES de subir la evidencia a Storage", async () => {
    // Mutacion M-b y, sobre todo, la que MUEVE la guarda debajo del upload: si el rechazo
    // llegara despues, cada intento bloqueado dejaria fotos huerfanas en el bucket.
    const repo = yaEnReparto();
    const { service, storage } = montar(repo);

    await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_21);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(repo.crearGestionYTransicionar).not.toHaveBeenCalled();
  });

  it("reservada para HOY: se gestiona con normalidad", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: DIA_21 }),
      ]),
    });
    const { service } = montar(repo);

    const r = await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_21);

    expect(r.status).toBe("ok");
    expect(repo.crearGestionYTransicionar).toHaveBeenCalledTimes(1);
  });

  it("sin dia de reparto: se gestiona (R8)", async () => {
    const repo = fakeRepo({
      findByIdsParaGestion: vi.fn(async () => [
        gestionRow({ estatusValue: "en_reparto", fechaReparto: null }),
      ]),
    });
    const { service } = montar(repo);

    expect((await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_21)).status).toBe("ok");
  });

  it("R6/R7: dos `now` distintos sobre la MISMA fila dan dos resultados distintos", async () => {
    const { service } = montar(yaEnReparto());

    expect((await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_21)).status).toBe("conflict");
    expect((await service.gestionar(ENTREGA, MENSAJERO, NOCHE_DEL_22)).status).toBe("ok");
  });
});

/* -------------------------------------------------------------------------- */
/* R9 / R10 · Lo que el bloqueo NO hace                                        */
/* -------------------------------------------------------------------------- */

describe("R9/R10 — el bloqueo NO oculta, NO saca del grupo y NO mueve los indicadores", () => {
  it("R9: la orden reservada SIGUE viniendo en su grupo de siempre", async () => {
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "reservada", estatusValue: "en_reparto", fechaReparto: DIA_22 }),
        asignacionRow({ id: "de-hoy", estatusValue: "en_reparto", fechaReparto: DIA_21 }),
      ]),
    });
    const { service } = montar(repo);

    const r = await service.listarMisAsignaciones(MENSAJERO, NOCHE_DEL_21);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.porGestionar.map((o) => o.id).sort()).toEqual(["de-hoy", "reservada"]);
    // Y con su marca puesta, que es lo que la card pinta.
    expect(r.porGestionar.find((o) => o.id === "reservada")?.esParaManana).toBe(true);
    expect(r.porGestionar.find((o) => o.id === "de-hoy")?.esParaManana).toBe(false);
  });

  it("R11/R14: el DTO trae la fecha ya resuelta como `YYYY-MM-DD`, no un `Date`", async () => {
    // La card tiene que poder decir QUE DIA sin construir un `Date` en el navegador: leer una
    // fecha con el reloj del cliente es la puerta que R14 cierra.
    const repo = fakeRepo({
      findMisAsignaciones: vi.fn(async () => [
        asignacionRow({ id: "reservada", fechaReparto: DIA_22 }),
        asignacionRow({ id: "sin-dia", fechaReparto: null }),
      ]),
    });
    const { service } = montar(repo);

    const r = await service.listarMisAsignaciones(MENSAJERO, NOCHE_DEL_21);
    if (r.status !== "ok") throw new Error("se esperaba ok");

    const porId = new Map(r.porGestionar.map((o) => [o.id, o]));
    expect(porId.get("reservada")?.fechaRepartoISO).toBe("2026-08-22");
    expect(porId.get("sin-dia")?.fechaRepartoISO).toBeNull();
  });

  it("R10: los KPIs son IDENTICOS con y sin reserva — una reservada cuenta donde contaba", async () => {
    // Lo que se compara es el mismo conjunto de ordenes con y sin dia de reparto. Si el bloqueo
    // hubiera tocado los indicadores, estos dos objetos diferirian.
    const filas = (fechaReparto: Date | null) => [
      asignacionRow({ id: "a", estatusValue: "en_reparto", montoCobrar: 1000, fechaReparto }),
      asignacionRow({ id: "b", estatusValue: "en_reparto", montoCobrar: 500, fechaReparto }),
    ];

    const conReserva = await montar(
      fakeRepo({ findMisAsignaciones: vi.fn(async () => filas(DIA_22)) }),
    ).service.listarMisAsignaciones(MENSAJERO, NOCHE_DEL_21);
    const sinReserva = await montar(
      fakeRepo({ findMisAsignaciones: vi.fn(async () => filas(null)) }),
    ).service.listarMisAsignaciones(MENSAJERO, NOCHE_DEL_21);

    if (conReserva.status !== "ok" || sinReserva.status !== "ok") {
      throw new Error("se esperaba ok en los dos");
    }
    expect(conReserva.kpis).toEqual(sinReserva.kpis);
    expect(conReserva.kpis).toEqual({
      pendientes: 2,
      entregadas: 0,
      porCobrar: 1500,
      totalACobrar: 1500,
    });
    // Y la ruta tampoco cambia: mismas paradas sin optimizar.
    expect(conReserva.ruta.paradasSinOptimizar).toBe(sinReserva.ruta.paradasSinOptimizar);
  });
});
