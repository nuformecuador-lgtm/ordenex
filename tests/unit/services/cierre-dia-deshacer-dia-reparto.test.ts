import { describe, it, expect, vi } from "vitest";

import type {
  AnularGestionInput,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { ITarifaZonaMensajeroRepository } from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

/**
 * FEATURE 261 (B10) — EL RELOJ DEL DESHACER, INYECTADO. R16, R19.
 *
 * QUE PASABA HASTA AQUI. `CierreDiaRepository.anularGestionYDevolverAGestion` hacia dentro de la
 * transaccion `asignadoAt: new Date()` y `fechaReparto: startOfDayCR()` —SIN argumento—: el
 * ACCESO A DATOS leia el reloj del proceso. Eso choca con la doctrina que la propia 246 escribio
 * tres archivos mas alla («`now` es un PARAMETRO con default: el reloj se inyecta en los tests y
 * jamas se lee dentro del calculo») y tenia dos consecuencias concretas: no se podia probar
 * «deshacer a las 23:59 del 21» sin falsear el reloj global, y `deshacerGestion` ni siquiera
 * tenia un `now` donde inyectarlo.
 *
 * ⚠️ QUE NO PRUEBA ESTE ARCHIVO. Que la fila persistida CONSERVE una reserva futura vive en
 * `tests/integration/db/deshacer-gestion-conserva-reserva.int.test.ts`, contra Postgres real: la
 * regla es un `CASE` DENTRO de la sentencia y ningun doble puede ejecutarla. Aqui se prueba lo
 * que el SERVICIO decide: que los dos valores salen del MISMO `now` y con el helper correcto.
 */

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };

type Repo = ICierreDiaRepository;

function gestionDeshacer(over: Partial<GestionDeshacerRow> = {}): GestionDeshacerRow {
  return {
    gestionId: "g1",
    ordenId: "o1",
    mensajeroId: "m1",
    resultado: "entregada",
    cierreId: null,
    anuladaAt: null,
    orden: { deletedAt: null, estatusId: "s-entregada", estatusValue: "entregada" },
    desdeAyudaTienda: false,
    ...over,
  };
}

function fakeRepo(over: Partial<Repo> = {}): Repo {
  return {
    findGestionesPendientes: vi.fn(async () => []),
    contarOrdenesPendientesGestion: vi.fn(async () => 0),
    existeCierreSolicitado: vi.fn(async () => false),
    existeCierreVencido: vi.fn(async () => false),
    transicionarVencidoASolicitado: vi.fn(async () => true),
    existeCierreRechazado: vi.fn(async () => false),
    transicionarRechazadoASolicitado: vi.fn(async () => true),
    crearCierre: vi.fn(async () => "c1"),
    findCierresByMensajero: vi.fn(async () => []),
    findCierrePropioConGestiones: vi.fn(async () => null),
    findCierresByMensajeroPaginado: vi.fn(async () => ({ items: [], total: 0 })),
    findGestionParaDeshacer: vi.fn(async () => gestionDeshacer()),
    findUltimaGestionNoAnuladaId: vi.fn(async () => "g1"),
    anularGestionYDevolverAGestion: vi.fn(async () => true),
    ...over,
  } as Repo;
}

function montar(repo: Repo = fakeRepo()) {
  const zonaRepo = { findCentralZonaId: vi.fn(async () => null) } as unknown as IZonaRepository;
  const ordenRepo = {
    findUsuarioZonaId: vi.fn(async () => "z1"),
    findUsuarioVehiculoId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async () => "s-reparto"),
    findBloqueoDetalle: vi.fn(async () => SIN_BLOQUEO),
  } as unknown as IOrdenRepository;
  const signedUrls: ISignedUrlProvider = {
    createSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    createSignedUrls: vi.fn(async () => ({})),
  };
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => null),
  };
  const service = new CierreDiaService(repo, zonaRepo, ordenRepo, signedUrls, tarifaZonaRepo);
  return { service, repo };
}

/** Lo que el servicio le pasa al repositorio en la unica escritura del deshacer. */
function inputDelRepo(repo: Repo): AnularGestionInput {
  const spy = repo.anularGestionYDevolverAGestion as ReturnType<typeof vi.fn>;
  expect(spy, "el repositorio no llego a invocarse").toHaveBeenCalledTimes(1);
  return spy.mock.calls[0][0] as AnularGestionInput;
}

describe("R19 — el dia y el instante los resuelve el SERVICIO, con el reloj inyectado", () => {
  it("22:30 CR del 21 (= 04:30Z del 22) -> el dia escrito es el 21, NO el 22", async () => {
    // ⭑ EL CASO QUE JUSTIFICA TODO EL PARAMETRO. En esa franja el dia UTC y el dia de Costa Rica
    // NO coinciden. Es EXACTAMENTE la hora del incidente medido en produccion: la guia 17496963
    // se gestiono a las 22:10 CR del 21 y se anulo a las 22:18.
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T04:30:00.000Z"));

    const input = inputDelRepo(repo);
    // El dia es una FECHA en la convencion `@db.Date`: medianoche UTC de la fecha calendario CR.
    expect(input.diaEnCurso).toEqual(new Date("2026-08-21T00:00:00.000Z"));
  });

  it("mutacion M-i: con `inicioDelDiaCREnUtc` (06:00Z) el dia se desplazaria seis horas", async () => {
    // Este caso existe para MATAR esa mutacion, y por eso afirma la hora exacta: el helper de la
    // convencion `timestamp` devolveria `...T06:00:00.000Z`, que como `DATE` es otro dia en
    // cuanto la sesion de Postgres no esta en UTC — el off-by-one que cerro la ficha 166.
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T04:30:00.000Z"));

    const dia = inputDelRepo(repo).diaEnCurso;
    expect(dia.getUTCHours()).toBe(0);
    expect(dia.getUTCMinutes()).toBe(0);
    expect(dia.getUTCSeconds()).toBe(0);
    expect(dia.getUTCMilliseconds()).toBe(0);
  });

  it("R16: el instante de la asignacion es el `now` INYECTADO, no uno leido dentro", async () => {
    const now = new Date("2026-08-22T04:30:00.000Z");
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, now);

    // Identidad, no «es un Date»: si el repositorio o el servicio hicieran su propio
    // `new Date()`, este caso caeria.
    expect(inputDelRepo(repo).asignadoAt).toBe(now);
  });

  it("R16: los DOS valores salen del MISMO reloj (mismo dia calendario CR)", async () => {
    // Si el instante saliera del reloj de Postgres y el dia del de la aplicacion, las dos
    // columnas podrian caer a distinto lado de la medianoche de Costa Rica — la clase exacta de
    // segunda-definicion-del-dia que este repo persigue.
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T04:30:00.000Z"));

    const { asignadoAt, diaEnCurso } = inputDelRepo(repo);
    // El dia CR de `asignadoAt`, calculado aqui a mano (offset fijo -6 h, CR no tiene DST).
    const crWall = new Date(asignadoAt.getTime() - 6 * 60 * 60 * 1000);
    const diaDeAsignadoAt = new Date(
      Date.UTC(crWall.getUTCFullYear(), crWall.getUTCMonth(), crWall.getUTCDate()),
    );
    expect(diaEnCurso).toEqual(diaDeAsignadoAt);
  });

  it("R6/R19: dos `now` distintos producen dos dias distintos, con la MISMA gestion", async () => {
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-21T18:00:00.000Z"));
    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T18:00:00.000Z"));

    const spy = repo.anularGestionYDevolverAGestion as ReturnType<typeof vi.fn>;
    const dias = spy.mock.calls.map((c) => (c[0] as AnularGestionInput).diaEnCurso.toISOString());
    expect(dias).toEqual(["2026-08-21T00:00:00.000Z", "2026-08-22T00:00:00.000Z"]);
  });

  it("justo despues de la medianoche CR (00:30 CR = 06:30Z) el dia ya es el nuevo", async () => {
    // La frontera por el otro lado. `startOfDayCR` corre el reloj -6 h: a las 06:30Z del 22 la
    // hora de pared de CR son las 00:30 del 22.
    const { service, repo } = montar();

    await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T06:30:00.000Z"));

    expect(inputDelRepo(repo).diaEnCurso).toEqual(new Date("2026-08-22T00:00:00.000Z"));
  });

  it("sin `now` explicito la firma sigue funcionando (el borde llama sin argumentos)", async () => {
    // La Server Action NO cambia: pasa el default. Este caso lo ata para que nadie convierta el
    // parametro en obligatorio y rompa el borde sin darse cuenta.
    const { service, repo } = montar();

    const r = await service.deshacerGestion("g1", MENSAJERO);

    expect(r).toEqual({ status: "ok", ordenId: "o1" });
    const input = inputDelRepo(repo);
    expect(input.asignadoAt).toBeInstanceOf(Date);
    expect(input.diaEnCurso.getUTCHours()).toBe(0);
  });

  it("si una guardia rechaza antes, NO se resuelve ningun dia ni se escribe nada", async () => {
    // R4 de la 261 dicho para esta via: el reloj no es un efecto, pero la ESCRITURA si.
    const repo = fakeRepo({
      findGestionParaDeshacer: vi.fn(async () => gestionDeshacer({ cierreId: "c-ya-cerrado" })),
    });
    const { service } = montar(repo);

    const r = await service.deshacerGestion("g1", MENSAJERO, new Date("2026-08-22T04:30:00.000Z"));

    expect(r.status).toBe("conflict");
    expect(repo.anularGestionYDevolverAGestion).not.toHaveBeenCalled();
  });
});
