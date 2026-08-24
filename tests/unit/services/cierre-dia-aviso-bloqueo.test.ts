import { describe, it, expect, vi } from "vitest";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import type {
  CierreGestionPendienteRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MensajeroBloqueadoContexto } from "@/lib/notificaciones/emitir";
import { conPagos } from "@/tests/fixtures/cierre-pagos";
import { SIN_BLOQUEO, type BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import { bloqueoDe, bloqueoPorAcumular } from "@/tests/fixtures/bloqueo-cierre";

/**
 * FEATURE 271 (T6.5, R40/R41/R47) — **EL PRODUCTOR DEL AVISO DE «QUEDASTE BLOQUEADO POR
 * ACUMULAR», EJERCITADO.**
 *
 * QUE FALTABA Y POR QUE ESTE ARCHIVO EXISTE (review 271, B3). El EMISOR estaba probado de verdad
 * —`notificacion-bloqueo-otro-cierre-avisa.test.ts` cuenta 4 filas contra Postgres, fija la entidad
 * y mata su mutacion— y el composition root tenia guardia sobre el USO efectivo. Faltaba el eslabon
 * del MEDIO: `notificarBloqueo` es el SEPTIMO parametro de `CierreDiaService` y **ninguna** de las
 * diez suites que construyen ese service se lo pasaba, asi que **borrar entera la llamada a
 * `avisarBloqueoPorAcumular` no ponia rojo nada**. Comprobar «leyendo» que el argumento es el
 * cierre correcto no es una red: es la misma familia de defecto que dejo el corte MUDO en
 * produccion el 22/08 con toda la suite en verde.
 *
 * QUE AFIRMA: que la solicitud que deja al mensajero en `N >= 2` EMITE; que la que lo deja en
 * `N = 1` **no**; que la que ni siquiera crea cierre —porque el gate ya lo bloqueo— tampoco; que la
 * entidad es el cierre RECIEN CREADO y no el mas viejo; que el detalle que viaja en el aviso se lee
 * DESPUES de la escritura; y que un aviso caido no invalida el cierre (R47).
 *
 * QUE NO AFIRMA, y donde vive: QUIEN recibe cada fila y con que texto —R40/R41— es del emisor y se
 * afirma contra Postgres (arriba) y por literal escrito a mano en `bloqueo-textos.test.ts`. La
 * REGLA N/V no se prueba aqui: el `BloqueoDetalle` es un doble, y la regla vive en
 * `tests/unit/utils/bloqueo-cierre.test.ts` + el `WHERE` contra Postgres en
 * `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const ZONA_MENSAJERO = "z-cartago";
const ZONA_DESTINO_DEL_CIERRE = "z-destino-de-la-bodega";
const CIERRE_NUEVO = "c-recien-creado";
const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };

function gestion(): CierreGestionPendienteRow {
  return conPagos({
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 10,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: "Av 1",
    zonaNombre: "Cartago",
    provinciaNombre: "Cartago",
    cantonNombre: "Central",
    distritoNombre: "Oriental",
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "12.50",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false,
    desdeAyudaTienda: false,
    causaIncidente: null,
    indemnizacion: null,
  });
}

function build(opts: {
  /**
   * Los detalles que devuelve `findBloqueoDetalle`, EN ORDEN de llamada. El primero es el que lee
   * el GATE (antes de escribir); el segundo, el que el aviso relee DESPUES de la escritura. Son
   * dos lecturas distintas del mismo metodo y en produccion dicen cosas distintas: antes de crear
   * el segundo cierre `N = 1` (libre) y despues `N = 2` (bloqueado).
   */
  detalles: BloqueoDetalle[];
  crearCierre?: () => Promise<string | null>;
  notificarBloqueo?: (ctx: MensajeroBloqueadoContexto) => Promise<void>;
}) {
  let i = 0;
  const findBloqueoDetalle = vi.fn(async () => {
    const detalle = opts.detalles[i] ?? opts.detalles[opts.detalles.length - 1];
    i += 1;
    return detalle as BloqueoDetalle;
  });
  const crearCierre = vi.fn(opts.crearCierre ?? (async () => CIERRE_NUEVO));
  const repo = {
    findGestionesPendientes: vi.fn(async () => [gestion()]),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    findCierreResolicitableMasViejo: vi.fn(async () => null),
    transicionarASolicitado: vi.fn(async () => true),
    findCierreParaAviso: vi.fn(async (cierreId: string) => ({
      id: cierreId,
      // La zona del AVISO es la DESTINO del cierre —el alcance del `adminSatelite`—, y por eso se
      // elige aqui distinta de la del mensajero: si el productor la sacara de `findUsuarioZonaId`
      // el caso quedaria rojo.
      destinoZonaId: ZONA_DESTINO_DEL_CIERRE,
      mensajeroNombre: "Ana",
    })),
    crearCierre,
    findCierresByMensajero: vi.fn(async () => []),
    findCierrePropioConGestiones: vi.fn(async () => null),
    findCierresByMensajeroPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findGestionParaDeshacer: vi.fn(async () => null),
    findUltimaGestionNoAnuladaId: vi.fn(async () => null),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
  } as unknown as ICierreDiaRepository;
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => null),
  } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => ZONA_MENSAJERO),
    findUsuarioVehiculoId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => "s-reparto"),
    findBloqueoDetalle,
  } as unknown as IOrdenRepository;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => TARIFA),
  };
  const signedUrls = {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async () => ({})),
  } as unknown as ISignedUrlProvider;
  const notificarCierre = vi.fn(async () => {});
  const notificarBloqueo = vi.fn(opts.notificarBloqueo ?? (async () => {}));
  const service = new CierreDiaService(
    repo,
    zonaRepo,
    ordenRepo,
    signedUrls,
    tarifaZonaRepo,
    notificarCierre, // 6.º: el aviso de «cierre por aprobar» (146/R24)
    // ⭑ EL SEPTIMO ARGUMENTO. Es lo unico que este archivo hace y las otras diez suites no.
    notificarBloqueo,
  );
  return { service, crearCierre, notificarCierre, notificarBloqueo, findBloqueoDetalle };
}

describe("271/T6.5 · R40/R41 — la solicitud que deja `N >= 2` avisa del bloqueo", () => {
  it("R40/R41: emite UNA vez, con el cierre RECIEN CREADO como entidad y la zona DESTINO", async () => {
    // El gate lee `N = 1, V = 0`: LIBRE, asi que deja crear el segundo cierre (R13).
    const antes = bloqueoDe({ n: 1, v: 0 });
    const despues = bloqueoPorAcumular("2026-08-21"); // ya con el nuevo dentro: `N = 2, V = 0`
    const { service, notificarBloqueo } = build({ detalles: [antes, despues] });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado", cierreId: CIERRE_NUEVO });
    expect(notificarBloqueo).toHaveBeenCalledTimes(1);
    const ctx = notificarBloqueo.mock.calls[0][0] as MensajeroBloqueadoContexto;
    // ⭑ El contexto ENTERO, `toEqual` exhaustivo.
    expect(ctx).toEqual({
      cierreId: CIERRE_NUEVO,
      zonaId: ZONA_DESTINO_DEL_CIERRE,
      mensajeroUsuarioId: MENSAJERO.usuarioId,
      bloqueo: despues,
    });
    // Y la entidad NO es el cierre mas viejo, que es el otro id que anda por aqui: con el, dos
    // bloqueos distintos compartirian `entidad_id` y la dedupe se comeria el segundo aviso (R44).
    expect(ctx.cierreId).not.toBe(despues.aResolverPrimero?.cierreId);
    // El detalle que viaja es el de DESPUES de la escritura, no el del gate (objetos distintos).
    expect(ctx.bloqueo).toBe(despues);
    expect(ctx.bloqueo.cierresAbiertos).toBe(2);
  });

  it("R40: el detalle del aviso se relee DESPUES de escribir el cierre — antes diria uno menos", async () => {
    const antes = bloqueoDe({ n: 1, v: 0 });
    const despues = bloqueoPorAcumular();
    const { service, crearCierre, findBloqueoDetalle } = build({ detalles: [antes, despues] });

    await service.solicitarCierre(MENSAJERO);

    expect(findBloqueoDetalle).toHaveBeenCalledTimes(2);
    const [lecturaDelGate, lecturaDelAviso] = findBloqueoDetalle.mock.invocationCallOrder;
    const [escritura] = crearCierre.mock.invocationCallOrder;
    expect(lecturaDelGate).toBeLessThan(escritura);
    expect(lecturaDelAviso).toBeGreaterThan(escritura);
  });

  it("R40: si la solicitud lo deja en `N = 1` NO se emite nada (y el aviso de «por aprobar» SI sale)", async () => {
    // El caso normal y el mas frecuente: el mensajero cierra su dia y no queda bloqueado. El
    // detalle de DESPUES es `N = 1, V = 0` —el cierre recien creado ya cuenta—, que es lo que la
    // base produce; dejarlo en `N = 0` seria un estado imposible tras escribir un cierre.
    const { service, notificarBloqueo, notificarCierre } = build({
      detalles: [SIN_BLOQUEO, bloqueoDe({ n: 1, v: 0 })],
    });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado" });
    expect(notificarBloqueo).not.toHaveBeenCalled();
    // El «no llamado» de arriba no es porque la ruta se cortara antes: el otro aviso SI se emitio.
    expect(notificarCierre).toHaveBeenCalledTimes(1);
  });

  it("R15/R40: si el gate ya lo tenia bloqueado no se crea cierre y por tanto no se avisa de nada", async () => {
    const { service, crearCierre, notificarBloqueo, notificarCierre } = build({
      detalles: [bloqueoPorAcumular()],
    });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r.status).toBe("conflict");
    expect(crearCierre).not.toHaveBeenCalled();
    expect(notificarBloqueo).not.toHaveBeenCalled();
    expect(notificarCierre).not.toHaveBeenCalled();
  });

  it("R47: un aviso que revienta NO invalida el cierre ya escrito, y queda registrado", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const { service, crearCierre } = build({
      detalles: [bloqueoDe({ n: 1, v: 0 }), bloqueoPorAcumular()],
      notificarBloqueo: async () => {
        throw new Error("campana caida");
      },
    });

    const r = await service.solicitarCierre(MENSAJERO);

    expect(r).toMatchObject({ status: "ok", via: "creado", cierreId: CIERRE_NUEVO });
    expect(crearCierre).toHaveBeenCalledTimes(1);
    // Y no es un `catch` vacio (docs/conventions.md): el fallo se registra con su operacion.
    const registrado = consola.mock.calls.map((c) => String(c[1] ?? "")).join(" ");
    expect(registrado).toContain("mensajero_bloqueado_por_cierres");
    consola.mockRestore();
  });
});
