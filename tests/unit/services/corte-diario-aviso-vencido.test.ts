import { describe, it, expect, vi } from "vitest";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import type {
  ICorteDiarioRepository,
  MensajeroSinCierreRow,
} from "@/lib/interfaces/repositories/ICorteDiarioRepository";
import type { ICierreDiaRepository } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type {
  ITarifaZonaMensajeroRepository,
  PagoTarifa,
} from "@/lib/interfaces/repositories/ITarifaZonaMensajeroRepository";
import type { CierreVencidoNotificador } from "@/lib/notificaciones/notificadores";
import type { CierreVencidoContexto } from "@/lib/notificaciones/emitir";
import { notificarCierreDiaVencidoCon } from "@/lib/notificaciones/notificadores";
import type { INotificacionRepository } from "@/lib/interfaces/repositories/INotificacionRepository";

/**
 * FEATURE 271 (T6.4, R38/R39/R47) — **EL PRODUCTOR DEL AVISO DEL CORTE, EJERCITADO.**
 *
 * QUE FALTABA Y POR QUE ESTE ARCHIVO EXISTE (review 271, B2). El aviso de «tu cierre del día
 * venció» tenia probado su TEXTO (`bloqueo-textos.test.ts`) y su LINEA de cableado en el
 * composition root (guardia de arbol sobre `app/api/cron/corte-diario`), y nada mas. Los dos
 * unicos tests que construian `CorteDiarioService` le pasaban SEIS argumentos —el notificador es
 * el SEPTIMO— asi que se quedaban con el default no-op: **borrar entera la llamada a
 * `notificarVencido` dejaba la suite completa en verde**. Un texto que nadie emite y un argumento
 * que nadie usa es exactamente el estado del 22/08, cuando el corte corria MUDO en produccion (0
 * filas en `notificacion` a las 00:03) con todo verde.
 *
 * Y es el aviso QUE MAS SE EMITE y EL UNICO QUE SE DISPARA SOLO, cada noche, sin nadie mirando.
 *
 * QUE AFIRMA ESTE ARCHIVO, que es la capa del MEDIO:
 *   · que el corte EMITE, una vez POR CIERRE CREADO, con el cierre / la zona / el mensajero / la
 *     jornada de ESA fila (no de la corrida entera, no del mensajero anterior);
 *   · que **NO** emite cuando `crearCierre` devuelve `null` —avisar de un cierre que no existe es
 *     peor que no avisar— ni cuando el mensajero se omite por no tener zona;
 *   · que un aviso caido NO tumba la corrida (R47), ejercitando el notificador REAL
 *     (`notificarCierreDiaVencidoCon`) contra un repositorio que revienta.
 *
 * QUE NO AFIRMA, y donde vive: QUIEN recibe cada fila es R38/R39 y se afirma sobre el EMISOR en
 * `tests/unit/notificaciones/cierre-vencido-destinatarios.test.ts`; los LITERALES de los textos, a
 * mano, en `tests/unit/notificaciones/bloqueo-textos.test.ts`. Aqui no se compara ni una cadena:
 * hacerlo contra la funcion que la genera estaria siempre verde.
 */

const TARIFA: PagoTarifa = { cobroEntregado: "5.00", cobroRechazado: "3.00" };
const ZONA_CENTRAL = "z-central";
const ZONA_SATELITE = "z-cartago";

/**
 * 00:03 CR del 22 de agosto — la hora REAL a la que este cron corre, y el caso medido en
 * produccion (`79cb2c0f`: nacio el 22, su jornada es el 21). La jornada esperada va escrita A MANO
 * mas abajo (`"2026-08-21"`), NUNCA derivada con `jornadaDelCorte`: compararla contra la funcion
 * que la genera estaria siempre verde, incluido el off-by-one que esta ficha vino a arreglar.
 */
const CRON_00_03_CR = new Date("2026-08-22T06:03:00.000Z");
const JORNADA_DEL_21 = "2026-08-21";

const ESTATUS_IDS: Record<string, string | null> = {
  en_reparto: "s-reparto",
  ayuda_tienda: "s-ayuda",
  sin_gestionar: "s-sin-gestionar",
};

function build(opts: {
  mensajeros?: MensajeroSinCierreRow[];
  /** Ids que `crearCierre` devuelve, EN ORDEN. `null` = no se creo nada (guarda «algo paso»). */
  cierresCreados?: (string | null)[];
  /** Notificador inyectado en el SEPTIMO parametro. Por defecto, un espia. */
  notificar?: CierreVencidoNotificador;
} = {}) {
  const corteRepo: ICorteDiarioRepository = {
    findMensajerosConActividadSinCierre: vi.fn(async () => opts.mensajeros ?? []),
  };
  const creados = opts.cierresCreados ?? ["cv-1"];
  let i = 0;
  const crearCierre = vi.fn(async () => creados[i++] ?? null);
  const cierreRepo = {
    // Sin gestiones pendientes: el corte crea igual (feature 109/R8, el cierre money-neutral) y
    // este archivo no mide totales.
    findGestionesPendientes: vi.fn(async () => []),
    crearCierre,
  } as unknown as Pick<ICierreDiaRepository, "findGestionesPendientes" | "crearCierre">;
  const zonaRepo = {
    findCentralZonaId: vi.fn(async () => ZONA_CENTRAL),
  } as unknown as Pick<IZonaRepository, "findCentralZonaId">;
  const ordenRepo = {
    findUsuarioVehiculoId: vi.fn(async () => null),
    findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS_IDS[v] ?? null),
  } as unknown as Pick<IOrdenRepository, "findUsuarioVehiculoId" | "findEstatusIdByValue">;
  const tarifaZonaRepo: ITarifaZonaMensajeroRepository = {
    resolvePagoTarifa: vi.fn(async () => TARIFA),
  };
  const logger = { warn: vi.fn() };
  const notificar = vi.fn(async () => {});
  const service = new CorteDiarioService(
    corteRepo,
    cierreRepo,
    zonaRepo as IZonaRepository,
    ordenRepo as IOrdenRepository,
    tarifaZonaRepo,
    logger,
    // ⭑ EL SEPTIMO ARGUMENTO. Es lo unico que este archivo hace y los otros dos no.
    opts.notificar ?? notificar,
  );
  return { service, crearCierre, notificar, logger };
}

/** Los contextos con los que se emitio, en orden. */
function emisiones(notificar: ReturnType<typeof vi.fn>): CierreVencidoContexto[] {
  return notificar.mock.calls.map((c) => c[0] as CierreVencidoContexto);
}

describe("271/T6.4 · R38/R39 — el corte EMITE el aviso del `vencido`", () => {
  it("R38/R39: TRES cierres creados -> TRES emisiones, cada una con su cierre, su zona, su mensajero y la jornada de la corrida", async () => {
    const { service, notificar } = build({
      mensajeros: [
        { mensajeroId: "m1", zonaId: ZONA_SATELITE },
        { mensajeroId: "m2", zonaId: ZONA_CENTRAL },
        { mensajeroId: "m3", zonaId: ZONA_SATELITE },
      ],
      cierresCreados: ["cv-1", "cv-2", "cv-3"],
    });

    const res = await service.ejecutarCorte(CRON_00_03_CR);

    expect(res).toEqual({ mensajerosEvaluados: 3, vencidosCreados: 3, mensajerosSinZona: 0 });
    // ⭑ EL CONTEXTO ENTERO, `toEqual` exhaustivo: una clave de mas o de menos mata el caso, y el
    // `cierreId` es el que devolvio `crearCierre` PARA ESE mensajero (cruzarlos deja rojo).
    expect(emisiones(notificar)).toEqual([
      {
        cierreId: "cv-1",
        zonaId: ZONA_SATELITE,
        mensajeroUsuarioId: "m1",
        jornadaCR: JORNADA_DEL_21,
      },
      {
        cierreId: "cv-2",
        zonaId: ZONA_CENTRAL,
        mensajeroUsuarioId: "m2",
        jornadaCR: JORNADA_DEL_21,
      },
      {
        cierreId: "cv-3",
        zonaId: ZONA_SATELITE,
        mensajeroUsuarioId: "m3",
        jornadaCR: JORNADA_DEL_21,
      },
    ]);
  });

  it("R22/R38: si `crearCierre` devuelve null NO se emite nada — no se avisa de un cierre que no existe", async () => {
    const { service, crearCierre, notificar } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: ZONA_SATELITE }],
      cierresCreados: [null],
    });

    const res = await service.ejecutarCorte(CRON_00_03_CR);

    expect(crearCierre).toHaveBeenCalledTimes(1); // se INTENTO: el corte llego hasta el final
    expect(res.vencidosCreados).toBe(0);
    expect(notificar).not.toHaveBeenCalled();
  });

  it("R38: con un mensajero que NO crea y otro que SI, se emite UNA sola vez y por el que creo", async () => {
    // El caso que distingue «emite por cierre creado» de «emite por mensajero evaluado»: si la
    // emision se moviera fuera del `if (cierreId !== null)` o fuera del bucle, aqui saldrian dos
    // avisos, o uno con el mensajero equivocado.
    const { service, notificar } = build({
      mensajeros: [
        { mensajeroId: "m-sin-nada", zonaId: ZONA_SATELITE },
        { mensajeroId: "m-con-cierre", zonaId: ZONA_CENTRAL },
      ],
      cierresCreados: [null, "cv-2"],
    });

    const res = await service.ejecutarCorte(CRON_00_03_CR);

    expect(res).toEqual({ mensajerosEvaluados: 2, vencidosCreados: 1, mensajerosSinZona: 0 });
    expect(emisiones(notificar)).toEqual([
      {
        cierreId: "cv-2",
        zonaId: ZONA_CENTRAL,
        mensajeroUsuarioId: "m-con-cierre",
        jornadaCR: JORNADA_DEL_21,
      },
    ]);
  });

  it("P2: al mensajero SIN zona no se le crea cierre ni se le avisa (no hay bodega a la que dirigirlo)", async () => {
    const { service, crearCierre, notificar } = build({
      mensajeros: [{ mensajeroId: "m-sin-zona", zonaId: null }],
    });

    const res = await service.ejecutarCorte(CRON_00_03_CR);

    expect(res).toEqual({ mensajerosEvaluados: 1, vencidosCreados: 0, mensajerosSinZona: 1 });
    expect(crearCierre).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
  });
});

/**
 * R47 — «SI la emisión de un aviso falla … NO DEBE hacer fallar la corrida del corte».
 *
 * Se ejercita el notificador REAL (`notificarCierreDiaVencidoCon`, la misma funcion que el binding
 * de produccion) contra un repositorio que revienta. El corte NO envuelve la llamada: la propiedad
 * la sostiene ENTERA el notificador, y por eso se prueba con el de verdad y no con un espia.
 */
class RepoQueRevienta implements INotificacionRepository {
  async crear(): Promise<boolean> {
    throw new Error("base caida");
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

describe("271/T6.4 · R47 — la campana caida no tumba la corrida del corte", () => {
  it("con el notificador REAL sobre un repositorio que revienta, el corte termina y devuelve su resumen", async () => {
    const logError = vi.fn();
    const { service } = build({
      mensajeros: [{ mensajeroId: "m1", zonaId: ZONA_SATELITE }],
      cierresCreados: ["cv-1"],
      notificar: notificarCierreDiaVencidoCon(new RepoQueRevienta(), { logError }),
    });

    const res = await service.ejecutarCorte(CRON_00_03_CR);

    // El cierre ya esta escrito cuando esto corre: la corrida NO puede caerse por el aviso.
    expect(res).toEqual({ mensajerosEvaluados: 1, vencidosCreados: 1, mensajerosSinZona: 0 });
    // Y no es un `catch` vacio (docs/conventions.md): queda registrado con su operacion y su causa.
    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("cierre_dia_vencido");
    expect((registrado.cause as Error).message).toBe("base caida");
  });
});
