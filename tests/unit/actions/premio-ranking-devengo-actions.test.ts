import { describe, it, expect, vi, afterEach } from "vitest";
import { RolValue } from "@prisma/client";
import {
  anularPremioAction,
  listarPremiosDelDiaAction,
  registrarPremioAction,
} from "@/lib/actions/premio-ranking-devengo";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { CierreDelDiaRepository } from "@/lib/repositories/CierreDelDiaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { CajaPremioRankingFeedService } from "@/lib/services/CajaPremioRankingFeedService";
import { PremioRankingDevengoService } from "@/lib/services/PremioRankingDevengoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IPremioRankingDevengoService,
  PremioTx,
  PremioTxRunner,
} from "@/lib/interfaces/services/IPremioRankingDevengoService";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

// Feature 293 (T4.3, design §7.3) — el BORDE de las tres Server Actions.
//
// Lo que se afirma aqui es lo que el borde decide y el servicio no puede: la sesion
// (`unauthenticated`) y la FORMA de la entrada (`validation_error`). El `forbidden` por rol es del
// servicio y tiene su propio archivo.
//
// Money-safe: aqui no hay montos; el borde no toca ni un importe.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };

function servicioEspia(): IPremioRankingDevengoService {
  return {
    listarPremiosDelDia: vi.fn(async () => ({
      status: "ok" as const,
      fecha: "2026-08-26",
      hayPodio: true,
      filas: [],
    })),
    registrarPremio: vi.fn(async () => ({
      status: "ok" as const,
      monto: "5000.00",
      cierreId: "c1",
    })),
    anularPremio: vi.fn(async () => ({ status: "ok" as const })),
  };
}

const deps = (service: IPremioRankingDevengoService, actor: Actor | null = MAESTRO) => ({
  service,
  getActor: async () => actor,
});

afterEach(() => vi.restoreAllMocks());

describe("sin sesion — `unauthenticated` ANTES de mirar la entrada", () => {
  it("las TRES actions salen sin construir ni llamar al servicio", async () => {
    const service = servicioEspia();

    expect(await listarPremiosDelDiaAction({ fecha: "2026-08-26" }, deps(service, null))).toEqual({
      status: "unauthenticated",
    });
    expect(await registrarPremioAction({ filaId: "f1" }, deps(service, null))).toEqual({
      status: "unauthenticated",
    });
    expect(
      await anularPremioAction({ filaId: "f1", motivo: "x" }, deps(service, null)),
    ).toEqual({ status: "unauthenticated" });

    expect(service.listarPremiosDelDia).not.toHaveBeenCalled();
    expect(service.registrarPremio).not.toHaveBeenCalled();
    expect(service.anularPremio).not.toHaveBeenCalled();
  });

  it("una entrada INVALIDA sin sesion sigue devolviendo `unauthenticated`, no el error de forma", async () => {
    // Orden deliberado: no se filtra por el mensaje de error si una fecha existe o no.
    const service = servicioEspia();

    expect(await listarPremiosDelDiaAction({ fecha: "no-es-fecha" }, deps(service, null))).toEqual({
      status: "unauthenticated",
    });
  });
});

describe("R8 — la fecha se valida en el BORDE, antes de tocar la base", () => {
  it("rechaza una fecha que NO EXISTE (el 31 de febrero, que `new Date` rueda al 3 de marzo)", async () => {
    const service = servicioEspia();

    const r = await listarPremiosDelDiaAction({ fecha: "2026-02-31" }, deps(service));

    expect(r.status).toBe("validation_error");
    expect(service.listarPremiosDelDia).not.toHaveBeenCalled();
  });

  it("rechaza formas que un regex laxo dejaria pasar", async () => {
    const service = servicioEspia();
    for (const fecha of ["2026-8-26", "26-08-2026", "", "2026-13-01", "hoy"]) {
      const r = await listarPremiosDelDiaAction({ fecha }, deps(service));
      expect(r.status, `deberia rechazar ${fecha}`).toBe("validation_error");
    }
    expect(service.listarPremiosDelDia).not.toHaveBeenCalled();
  });

  it("rechaza una fecha POSTERIOR a hoy en Costa Rica", async () => {
    const service = servicioEspia();
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const r = await listarPremiosDelDiaAction(
      { fecha: fechaCalendarioCR(manana) },
      deps(service),
    );

    expect(r.status).toBe("validation_error");
    expect(service.listarPremiosDelDia).not.toHaveBeenCalled();
  });

  it("ACEPTA hoy en CR: el limite es «posterior a hoy», no «anterior a hoy»", async () => {
    const service = servicioEspia();

    const r = await listarPremiosDelDiaAction({ fecha: fechaCalendarioCR() }, deps(service));

    expect(r.status).toBe("ok");
  });

  it("Q3: NO hay tope de antiguedad — una fecha de hace meses pasa el borde", async () => {
    const service = servicioEspia();

    const r = await listarPremiosDelDiaAction({ fecha: "2026-01-15" }, deps(service));

    expect(r.status).toBe("ok");
    expect(service.listarPremiosDelDia).toHaveBeenCalledWith({ fecha: "2026-01-15" }, MAESTRO);
  });

  it("una clave de mas muere aqui: el schema es `.strict()`", async () => {
    const service = servicioEspia();

    const r = await listarPremiosDelDiaAction(
      { fecha: "2026-08-26", mensajeroId: "m-ajeno" },
      deps(service),
    );

    expect(r.status).toBe("validation_error");
    expect(service.listarPremiosDelDia).not.toHaveBeenCalled();
  });
});

describe("R16 — al registrar, del cliente solo viaja `filaId`", () => {
  it("el paso limpio llega al servicio con `filaId` y NADA mas", async () => {
    const service = servicioEspia();

    const r = await registrarPremioAction({ filaId: "f1" }, deps(service));

    expect(r).toEqual({ status: "ok", monto: "5000.00", cierreId: "c1" });
    expect(service.registrarPremio).toHaveBeenCalledWith({ filaId: "f1" }, MAESTRO);
  });

  it("un `monto`, un `mensajeroId` o un `cierreId` colados MATAN la peticion (no se ignoran)", async () => {
    // `.strict()` a proposito: descartarlos en silencio dejaria al cliente creyendo que influyo.
    const service = servicioEspia();

    for (const extra of [
      { monto: "999999.99" },
      { mensajeroId: "m-ajeno" },
      { cierreId: "c-ajeno" },
      { premioDia: "2026-01-01" },
    ]) {
      const r = await registrarPremioAction({ filaId: "f1", ...extra }, deps(service));
      expect(r.status, `deberia rechazar ${JSON.stringify(extra)}`).toBe("validation_error");
    }
    expect(service.registrarPremio).not.toHaveBeenCalled();
  });

  it("`filaId` vacio o ausente -> `validation_error`", async () => {
    const service = servicioEspia();

    for (const input of [{}, { filaId: "" }, { filaId: "   " }, { filaId: 7 }]) {
      const r = await registrarPremioAction(input, deps(service));
      expect(r.status).toBe("validation_error");
    }
    expect(service.registrarPremio).not.toHaveBeenCalled();
  });

  it("los estados de DOMINIO viajan tal cual, sin traducirse a un error generico", async () => {
    for (const salida of [
      { status: "ya_registrado" as const },
      { status: "anulado" as const },
      { status: "sin_premio" as const },
      { status: "sin_entregas" as const }, // feature 297
      { status: "sin_cierre" as const },
      { status: "cierre_no_aprobado" as const, estado: "solicitado" },
      { status: "no_encontrado" as const },
      { status: "forbidden" as const },
    ]) {
      const service = servicioEspia();
      (service.registrarPremio as ReturnType<typeof vi.fn>).mockResolvedValue(salida);

      expect(await registrarPremioAction({ filaId: "f1" }, deps(service))).toEqual(salida);
    }
  });
});

describe("R30 — anular exige MOTIVO, y el borde lo impone", () => {
  it("sin motivo, vacio o solo espacios -> `validation_error` sin llamar al servicio", async () => {
    const service = servicioEspia();

    for (const input of [
      { filaId: "f1" },
      { filaId: "f1", motivo: "" },
      { filaId: "f1", motivo: "    " },
      { filaId: "f1", motivo: null },
    ]) {
      const r = await anularPremioAction(input, deps(service));
      expect(r.status, `deberia rechazar ${JSON.stringify(input)}`).toBe("validation_error");
    }
    expect(service.anularPremio).not.toHaveBeenCalled();
  });

  it("el motivo llega RECORTADO al servicio", async () => {
    const service = servicioEspia();

    await anularPremioAction({ filaId: "f1", motivo: "  se pago por fuera  " }, deps(service));

    expect(service.anularPremio).toHaveBeenCalledWith(
      { filaId: "f1", motivo: "se pago por fuera" },
      MAESTRO,
    );
  });

  it("`ya_anulado` y `no_registrado` viajan tal cual: no son errores", async () => {
    for (const salida of [
      { status: "ya_anulado" as const },
      { status: "no_registrado" as const },
      { status: "no_encontrado" as const },
      { status: "forbidden" as const },
    ]) {
      const service = servicioEspia();
      (service.anularPremio as ReturnType<typeof vi.fn>).mockResolvedValue(salida);

      expect(
        await anularPremioAction({ filaId: "f1", motivo: "x" }, deps(service)),
      ).toEqual(salida);
    }
  });
});

/* -------------------------------------------------------------------------------------------- */
/* T4.3 — EL COMPOSITION ROOT, EJERCITADO                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Feature 293 (T4.3) — `buildService()` de `lib/actions/premio-ranking-devengo.ts`, MEDIDO.
 *
 * POR QUE EXISTE ESTE BLOQUE. Todos los casos de arriba inyectan `deps.service`, que es lo
 * correcto para probar el borde y a la vez lo que deja el CABLEADO sin ejercitar: el
 * composition root no lo corre nadie. Y ahi el compilador no llega — se midio:
 *
 *     - (fn) => prisma.$transaction((tx) => fn(tx as unknown as PremioTx))   // hoy
 *     + (fn) => fn(prisma as unknown as PremioTx)                            // mutacion
 *
 * compila, pasa `typecheck`, pasa `lint` y pasaba la suite ENTERA, porque el test de servicio
 * inyecta su runner en memoria y el [PG] inyecta uno de SAVEPOINT. Y rompe R20 en silencio: el
 * devengo quedaria escrito con la caja sin cargar, o al reves. Dinero descuadrado sin rastro.
 *
 * QUE SE COMPRUEBA, y es la regla que este repo aprendio a golpes (2 de 7 notificadores muertos
 * con la suite verde): que alguien PASA la dependencia, no que el archivo la importe. Por eso no
 * hay ni una asercion sobre el texto del modulo: se llama a la action **sin `deps.service`**, se
 * atrapa la instancia que construyo y se le miran las CINCO piezas de verdad.
 *
 * Sin base de datos: la unica llamada que tocaria Postgres —`registrarPremio`— se sustituye por
 * una implementacion que solo se queda con `this`. `getPrismaClient()` construye el cliente pero
 * no abre conexion hasta la primera consulta, y aqui no hay ninguna.
 */
interface PiezasDelServicio {
  snapshotRepo: unknown;
  cierreRepo: unknown;
  libroRepo: unknown;
  caja: unknown;
  runTransaction: PremioTxRunner;
}

async function piezasDelServicioReal(): Promise<PiezasDelServicio> {
  // Caja mutable y no una variable suelta: `this` se asigna dentro de un callback y el
  // estrechamiento de tipos de TS no cruza esa frontera.
  const atrapado: { servicio: PremioRankingDevengoService | null } = { servicio: null };

  const espia = vi
    .spyOn(PremioRankingDevengoService.prototype, "registrarPremio")
    .mockImplementation(async function (this: PremioRankingDevengoService) {
      atrapado.servicio = this;
      return { status: "no_encontrado" as const };
    });

  try {
    // SIN `deps.service`: este es el unico camino del archivo que ejecuta `buildService()`.
    const r = await registrarPremioAction({ filaId: "f1" }, { getActor: async () => MAESTRO });
    // Control de no-vacuidad: si la action no hubiera llegado al servicio, lo de abajo no
    // mediria nada y `atrapado.servicio` seguiria en `null`.
    expect(r).toEqual({ status: "no_encontrado" });
  } finally {
    espia.mockRestore();
  }

  if (atrapado.servicio === null) {
    throw new Error("la action no construyo `PremioRankingDevengoService`");
  }
  // Las cinco piezas viven en campos `private`, que lo son solo para el compilador.
  return atrapado.servicio as unknown as PiezasDelServicio;
}

describe("T4.3 — `buildService()`: la action construida DE VERDAD", () => {
  it("recibe los repositorios y el puerto de caja REALES, no algo de la misma forma", async () => {
    const piezas = await piezasDelServicioReal();

    expect(piezas.snapshotRepo).toBeInstanceOf(RankingSnapshotRepository);
    expect(piezas.cierreRepo).toBeInstanceOf(CierreDelDiaRepository);
    // R13/R21: el LIBRO llega por su repositorio real, que es su unico escritor.
    expect(piezas.libroRepo).toBeInstanceOf(PagoMensajeroMovimientoRepository);
    // R20: la caja SIEMPRE por el puerto estrecho; el servicio no ve `WalletMovimientoRepository`.
    expect(piezas.caja).toBeInstanceOf(CajaPremioRankingFeedService);
    expect(typeof piezas.runTransaction).toBe("function");
  });

  it("R20: el runner inyectado abre UNA transaccion de Prisma y entrega EL CLIENTE DE ESA transaccion", async () => {
    const piezas = await piezasDelServicioReal();
    const clienteBase = getPrismaClient();
    // El `tx` que Prisma entregaria. Se distingue del cliente de fuera por IDENTIDAD, que es
    // exactamente lo que la mutacion pierde.
    const txDeLaTransaccion = { soyElClienteDeLaTransaccion: true } as unknown as PremioTx;

    const espiaTx = vi.spyOn(clienteBase, "$transaction");
    espiaTx.mockImplementation((async (fn: (tx: PremioTx) => Promise<unknown>) =>
      fn(txDeLaTransaccion)) as never);

    try {
      const entregado = await piezas.runTransaction(async (tx) => tx);

      // (1) hubo transaccion: con `(fn) => fn(prisma)` esto es 0.
      expect(espiaTx).toHaveBeenCalledTimes(1);
      expect(typeof espiaTx.mock.calls[0]?.[0]).toBe("function"); // la forma interactiva, no el array
      // (2) y el servicio escribe DENTRO de ella, no por fuera.
      expect(entregado).toBe(txDeLaTransaccion);
      expect(entregado as unknown).not.toBe(clienteBase);
    } finally {
      espiaTx.mockRestore();
    }
  });

  it("cada llamada al runner abre SU transaccion (dos registros no comparten una)", async () => {
    const piezas = await piezasDelServicioReal();
    const clienteBase = getPrismaClient();

    let n = 0;
    const espiaTx = vi.spyOn(clienteBase, "$transaction");
    espiaTx.mockImplementation((async (fn: (tx: PremioTx) => Promise<unknown>) => {
      n += 1;
      return fn({ nDeLaTransaccion: n } as unknown as PremioTx);
    }) as never);

    try {
      const primero = await piezas.runTransaction(async (tx) => tx);
      const segundo = await piezas.runTransaction(async (tx) => tx);

      expect(espiaTx).toHaveBeenCalledTimes(2);
      expect(primero).not.toBe(segundo);
    } finally {
      espiaTx.mockRestore();
    }
  });
});
