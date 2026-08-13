import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DevolucionSlaService } from "@/lib/services/DevolucionSlaService";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import type {
  DevueltaSlaRow,
  EscalarDevueltaSlaInput,
  IDevolucionSlaRepository,
  LiberarDevueltaSlaInput,
} from "@/lib/interfaces/repositories/IDevolucionSlaRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";
import {
  prismaGestionSobreFilas,
  type FilaGestionFake,
} from "@/tests/fixtures/intentos-entrega";

// Feature 99 (T9/T10) — service del cron SLA. Dobles de repo/servicio (sin DB/HTTP), reloj FIJO.
// Aqui aterrizan las aserciones de reintento/escalado MIGRADAS de la 47 (R30): la decision de
// reintentar a bodega (<umbral) o escalar a `rechazada` (>=umbral) YA NO vive en `gestionar`, vive
// aqui. Cubre R13/R14/R15/R16/R17/R22/R26/R27/R28 + idempotencia (R24/R25).

const CENTRAL = "z-central";
const SATELITE = "z-limon";
const NOW = new Date("2026-07-20T12:00:00.000Z");

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

const ESTATUS: Record<string, string> = {
  devuelta: "os-devuelta",
  en_bodega_central: "os-en-bodega",
  en_bodega_satelite: "os-en-bodega-satelite",
  rechazada: "os-rechazada",
};

function row(overrides: Partial<DevueltaSlaRow> = {}): DevueltaSlaRow {
  return {
    ordenId: "o1",
    zonaId: SATELITE,
    mensajeroId: "m1",
    causa: "not_found",
    ancladaAt: new Date(NOW.getTime() - 25 * HORA), // por defecto: not_found vencida
    ...overrides,
  };
}

function fakeRepo(overrides: Partial<IDevolucionSlaRepository> = {}): IDevolucionSlaRepository {
  return {
    findDevueltasSla: vi.fn(async () => [row()]),
    liberarDevueltaSla: vi.fn(async () => true),
    escalarDevueltaSla: vi.fn(async () => true),
    ...overrides,
  };
}

function fakeZonaRepo(centralId: string | null = CENTRAL): Pick<IZonaRepository, "findCentralZonaId"> {
  return { findCentralZonaId: vi.fn(async () => centralId) };
}

function fakeOrdenRepo(
  map: Record<string, string> = ESTATUS,
): Pick<IOrdenRepository, "findEstatusIdByValue"> {
  return { findEstatusIdByValue: vi.fn(async (v: string) => map[v] ?? null) };
}

function fakeHistorial(
  intentos = 0,
): Pick<IOrdenHistorialService, "contarIntentos"> {
  return { contarIntentos: vi.fn(async () => intentos) };
}

function newService(
  repo: IDevolucionSlaRepository = fakeRepo(),
  historial: Pick<IOrdenHistorialService, "contarIntentos"> = fakeHistorial(),
  zonaRepo = fakeZonaRepo(),
  ordenRepo = fakeOrdenRepo(),
) {
  return new DevolucionSlaService(
    repo,
    zonaRepo as unknown as IZonaRepository,
    ordenRepo as unknown as IOrdenRepository,
    historial as unknown as IOrdenHistorialService,
    { warn: vi.fn() },
  );
}

describe("ejecutar — not_found: ventana de 24h (R14/R15/R16)", () => {
  it("R14: not_found AUN viva (<24h) -> evaluada, no actua", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "not_found", ancladaAt: new Date(NOW.getTime() - 23 * HORA) }),
      ]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it("R15: not_found vencida + intentos < umbral (3) -> reintento a bodega", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ zonaId: SATELITE, ancladaAt: new Date(NOW.getTime() - 25 * HORA) }),
      ]),
    });
    const res = await newService(repo, fakeHistorial(2)).ejecutar(NOW); // 2 < 3
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
    const arg = (repo.liberarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as LiberarDevueltaSlaInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega-satelite"); // zona satelite
    expect(arg.estatusDevueltaId).toBe("os-devuelta");
  });

  it("R15: zona CENTRAL -> reintento a en_bodega_central (central)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ zonaId: CENTRAL })]),
    });
    await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    const arg = (repo.liberarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as LiberarDevueltaSlaInput;
    expect(arg.destinoEstatusId).toBe("os-en-bodega");
  });

  it("R16: not_found vencida + intentos >= umbral (3) -> escala a rechazada", async () => {
    const repo = fakeRepo({ findDevueltasSla: vi.fn(async () => [row()]) });
    const res = await newService(repo, fakeHistorial(3)).ejecutar(NOW); // 3 >= 3
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as EscalarDevueltaSlaInput;
    expect(arg.estatusRechazadaId).toBe("os-rechazada");
  });
});

describe("ejecutar — wrong_number / wrong_address: 5 dias -> rechazo directo (R13/R17)", () => {
  it("R13: wrong_number AUN viva (<5d) -> evaluada, no actua", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_number", ancladaAt: new Date(NOW.getTime() - 4 * DIA) }),
      ]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it.each(["wrong_number", "wrong_address"] as const)(
    "R17: %s vencida (>=5d) -> escala DIRECTO a rechazada, sin mirar el conteo de intentos",
    async (causa) => {
      const historial = fakeHistorial(0); // aunque intentos=0, escala igual (sin bucle)
      const repo = fakeRepo({
        findDevueltasSla: vi.fn(async () => [
          row({ causa, ancladaAt: new Date(NOW.getTime() - 6 * DIA) }),
        ]),
      });
      const res = await newService(repo, historial).ejecutar(NOW);
      expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
      expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
      // R17: no consulta el conteo de intentos para las causas de rechazo directo.
      expect(historial.contarIntentos).not.toHaveBeenCalled();
    },
  );
});

// Feature 215 (T12) — EL BLOQUE DEL DINERO. El criterio de "intento" cambio de sitio y ese
// numero es el que decide entre liberar a bodega (reintento) y escalar a `rechazada`, que
// dispara `cobroRechazado` (56) contra la tienda. El servicio NO cambio de codigo: consume
// `contarIntentos`, que ahora devuelve el numero nuevo. Lo que se fija aqui es el DESENLACE.
//
// A DIFERENCIA del bloque de la 160, estos casos NO se montan sobre `fakeHistorial(n)`: montan
// el `OrdenHistorialService` REAL sobre el `OrdenHistorialRepository` REAL sobre el doble de
// Prisma que evalua el predicado contra filas de `gestion_orden`. Con el conteo mockeado el
// caso no probaria NADA del criterio nuevo — solo que 3 >= 3.
describe("ejecutar — el criterio de intentos por CIERRE APROBADO y el escalado (215/R3/R10/R11/R15/R29) [💰]", () => {
  const ORDEN = "o1";

  /**
   * Fila de `gestion_orden` de la orden bajo prueba. `origenTiposHistorial` declara de donde
   * NACE la gestion (feature 215/T21): por defecto una VISITA REAL del mensajero
   * (`origen_tipo = 'gestion'`), que es lo unico que cuenta como intento. Las gestiones
   * SINTETICAS (`escalado_devuelta_sla`, `reprogramacion_tienda`) lo pasan explicitamente.
   */
  function gestion(
    resultado: string,
    cierreId: string | null,
    cierreEstado: string | null = "aprobado",
    anuladaAt: Date | null = null,
    origenTiposHistorial: string[] = ["gestion"],
  ): FilaGestionFake {
    return { ordenId: ORDEN, resultado, anuladaAt, cierreId, cierreEstado, origenTiposHistorial };
  }

  /** El derivador REAL (service + repo reales) sobre esas filas de gestion. */
  function historialReal(filas: FilaGestionFake[]) {
    const prisma = prismaGestionSobreFilas(filas);
    const historialRepo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    const ordenRepo = {
      findById: vi.fn(async () => null),
      findUsuarioZonaId: vi.fn(async () => null),
      findEstatusIdByValue: vi.fn(async (v: string) => ESTATUS[v] ?? null),
    };
    const service = new OrdenHistorialService(
      ordenRepo as unknown as IOrdenRepository,
      historialRepo as unknown as IOrdenHistorialRepository,
    );
    return { prisma, service };
  }

  function correr(filas: FilaGestionFake[]) {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ ordenId: ORDEN, causa: "not_found" })]),
    });
    const { service, prisma } = historialReal(filas);
    const svc = newService(repo, service as unknown as Pick<IOrdenHistorialService, "contarIntentos">);
    return { repo, svc, prisma, service };
  }

  // R15/R3 — el desenlace de dinero: 3 cierres APROBADOS con resultado contable alcanzan el
  // umbral (3) y la orden ESCALA a `rechazada` -> se cobrara el rechazo.
  it("R15/R3: 3 cierres APROBADOS con resultado contable, umbral 3 -> ESCALA", async () => {
    const { repo, svc } = correr([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2"),
      gestion("rechazada", "c3"),
    ]);
    const res = await svc.ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as EscalarDevueltaSlaInput;
    expect(arg.estatusRechazadaId).toBe("os-rechazada");
  });

  // R3/R10 — ⛔ Q5, ABIERTA. Los MISMOS tres resultados, pero con los cierres sin aprobar: el
  // conteo es 0 y la orden se LIBERA. Si esos cierres nunca se aprueban, la orden gira
  // indefinidamente y el `cobroRechazado` NUNCA se emite. Se afirma el comportamiento actual;
  // ninguna de las tres mitigaciones de `design.md §7bis` esta implementada.
  it.each(["solicitado", "vencido", "rechazado"] as const)(
    "R3 (⛔Q5): los mismos 3 resultados con los cierres en `%s` -> conteo 0 -> LIBERA",
    async (estado) => {
      const { repo, svc, service } = correr([
        gestion("devuelta", "c1", estado),
        gestion("reprogramada", "c2", estado),
        gestion("rechazada", "c3", estado),
      ]);
      expect(await service.contarIntentos(ORDEN)).toBe(0);

      const res = await svc.ejecutar(NOW);
      expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
      expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
    },
  );

  // R10: la devolucion del mensajero YA NO suma por si sola. Antes sumaba en el instante de la
  // gestion (la transicion #14 contaba); ahora, con el cierre sin aprobar, no aporta nada.
  it("R10: una `devuelta` del mensajero cuyo cierre AUN no esta aprobado no suma por si sola", async () => {
    const { svc, service, repo } = correr([gestion("devuelta", "c1", "solicitado")]);
    expect(await service.contarIntentos(ORDEN)).toBe(0);
    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R11: idem con la reprogramacion del mensajero (la transicion #13 contaba con la 160).
  it("R11: una `reprogramada` del mensajero cuyo cierre aun no esta aprobado no suma por si sola", async () => {
    const { service } = correr([gestion("reprogramada", "c1", "solicitado")]);
    expect(await service.contarIntentos(ORDEN)).toBe(0);
  });

  // R29/R4 — NO-DOBLE-CONTEO. Dos gestiones vigentes de la MISMA orden en el MISMO cierre
  // aprobado suman 1, no 2. Y leer el conteo dos veces (equivalente a re-aprobar el mismo
  // cierre: `resolverCierre` es idempotente) da EL MISMO numero.
  it("R29/R4: 2 gestiones vigentes en el MISMO cierre aprobado -> conteo 1 -> LIBERA, y releer da lo mismo", async () => {
    const { repo, svc, service } = correr([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c1"),
    ]);
    const primera = await service.contarIntentos(ORDEN);
    const segunda = await service.contarIntentos(ORDEN);
    expect(primera).toBe(1);
    expect(segunda).toBe(primera); // R4: re-aprobar el mismo cierre no suma otra vez

    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R5/R32: la gestion anulada antes de que su cierre se apruebe NO llega a contar. No
  // "descuenta": simplemente nunca aporto su cierre.
  it("R5: gestiones anuladas antes de que su cierre se apruebe -> no llegan a contar", async () => {
    const anulada = new Date("2026-07-19T10:00:00.000Z");
    const { repo, svc, service } = correr([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2", "aprobado", anulada),
      gestion("rechazada", "c3", "aprobado", anulada),
    ]);
    expect(await service.contarIntentos(ORDEN)).toBe(1); // solo `c1`

    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R12 — EL DESENLACE DE DINERO DEL DISCRIMINADOR (feature 215/T21). La orden tuvo DOS visitas
  // reales (cierres aprobados) y ademas la tienda la reprogramo desde el escritorio; esa gestion
  // sintetica (`reprogramacion_tienda`) cayo en un TERCER cierre del mismo mensajero, tambien
  // aprobado. Sin la sexta condicion del predicado el conteo diria 3 = umbral y el cron ESCALARIA
  // a `rechazada`, cobrando el `cobroRechazado` (56) a la tienda una vuelta antes de tiempo por
  // una reprogramacion de escritorio que no fue una visita de nadie. Con ella son 2 y la orden se
  // LIBERA para un reintento real.
  it("R12: 2 visitas reales + la reprogramacion de la TIENDA (cierre aprobado) -> 2, LIBERA y NO cobra", async () => {
    const { repo, svc, service } = correr([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2"),
      gestion("reprogramada", "c3", "aprobado", null, ["reprogramacion_tienda"]),
    ]);
    expect(await service.contarIntentos(ORDEN)).toBe(2); // no 3

    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R18-b: lo mismo con la sintetica del PROPIO cron. Si contara, el escalado se auto-alimentaria:
  // el cron escala una vez, su gestion sintetica sube el conteo y la siguiente vuelta encontraria
  // el umbral ya cruzado por su propio efecto.
  it("R18-b: 2 visitas reales + la sintetica del ESCALADO SLA (cierre aprobado) -> 2, LIBERA", async () => {
    const { repo, svc, service } = correr([
      gestion("devuelta", "c1"),
      gestion("reprogramada", "c2"),
      gestion("rechazada", "c3", "aprobado", null, ["escalado_devuelta_sla"]),
    ]);
    expect(await service.contarIntentos(ORDEN)).toBe(2); // no 3

    const res = await svc.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  // R16: el resto del cron no cambia. `wrong_number`/`wrong_address` escalan DIRECTO sin mirar
  // el conteo — el criterio nuevo NO puede haber alterado esta rama.
  it("R16: `wrong_number`/`wrong_address` siguen escalando DIRECTO, sin consultar el conteo", async () => {
    const historial = fakeHistorial(0);
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", ancladaAt: new Date(NOW.getTime() - 6 * DIA) }),
      ]),
    });
    const res = await newService(repo, historial).ejecutar(NOW);

    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 1, omitidas: 0 });
    expect(historial.contarIntentos).not.toHaveBeenCalled();
  });

  it("R16: el conteo se consulta UNA vez por orden y con SU id (contrato intacto)", async () => {
    const historial = fakeHistorial(0);
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ ordenId: "o-a", causa: "not_found" }),
        row({ ordenId: "o-b", causa: "not_found" }),
      ]),
    });
    await newService(repo, historial).ejecutar(NOW);

    expect(historial.contarIntentos).toHaveBeenCalledTimes(2);
    expect(historial.contarIntentos).toHaveBeenNthCalledWith(1, "o-a");
    expect(historial.contarIntentos).toHaveBeenNthCalledWith(2, "o-b");
  });
});

describe("ejecutar — atribucion del escalado (R22)", () => {
  it("R22: escalar atribuye el mensajero de la gestion devuelta vigente + motivo 'escalado SLA <causa>'", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ causa: "wrong_address", mensajeroId: "m-99", ancladaAt: new Date(NOW.getTime() - 6 * DIA) }),
      ]),
    });
    await newService(repo).ejecutar(NOW);
    const arg = (repo.escalarDevueltaSla as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as EscalarDevueltaSlaInput;
    expect(arg.mensajeroId).toBe("m-99");
    expect(arg.motivo).toBe("escalado SLA wrong_address");
  });
});

describe("ejecutar — reloj inyectable (R13)", () => {
  it("R13: la MISMA orden es viva con un `now` temprano y vencida con uno tardio", async () => {
    const ancladaAt = new Date("2026-07-20T00:00:00.000Z");
    const build = () =>
      fakeRepo({ findDevueltasSla: vi.fn(async () => [row({ causa: "not_found", ancladaAt })]) });

    const viva = build();
    const rViva = await newService(viva, fakeHistorial(0)).ejecutar(
      new Date(ancladaAt.getTime() + 23 * HORA),
    );
    expect(rViva).toEqual({ evaluadas: 1, liberadas: 0, escaladas: 0, omitidas: 0 });

    const vencida = build();
    const rVencida = await newService(vencida, fakeHistorial(0)).ejecutar(
      new Date(ancladaAt.getTime() + 25 * HORA),
    );
    expect(rVencida).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 0 });
  });
});

describe("ejecutar — resiliencia, idempotencia y datos incompletos (R24/R25/R26/R27/R28)", () => {
  it("R28: causa null -> omitida, sin adivinar ventana ni actuar", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ causa: null })]),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
    expect(repo.liberarDevueltaSla).not.toHaveBeenCalled();
    expect(repo.escalarDevueltaSla).not.toHaveBeenCalled();
  });

  it("R27: catalogo de estados incompleto -> conteos 0, no consulta candidatas, avisa", async () => {
    const warn = vi.fn();
    const repo = fakeRepo();
    const service = new DevolucionSlaService(
      repo,
      fakeZonaRepo() as unknown as IZonaRepository,
      fakeOrdenRepo({ devuelta: "os-devuelta" }) as unknown as IOrdenRepository, // faltan bodega/rechazada
      fakeHistorial() as unknown as IOrdenHistorialService,
      { warn },
    );
    const res = await service.ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0 });
    expect(repo.findDevueltasSla).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("R26: una orden que lanza -> omitida, la corrida continua con las demas", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [
        row({ ordenId: "o-boom", zonaId: SATELITE }),
        row({ ordenId: "o-ok", zonaId: SATELITE }),
      ]),
      liberarDevueltaSla: vi.fn(async (input: LiberarDevueltaSlaInput) => {
        if (input.ordenId === "o-boom") throw new Error("db down");
        return true;
      }),
    });
    const res = await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 1, escaladas: 0, omitidas: 1 });
  });

  it("R24/R25: liberar guardado por estado devuelve false -> omitida (no re-actua)", async () => {
    const repo = fakeRepo({ liberarDevueltaSla: vi.fn(async () => false) });
    const res = await newService(repo, fakeHistorial(0)).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
  });

  it("R24/R25: escalar guardado por estado devuelve false -> omitida (no doble efecto)", async () => {
    const repo = fakeRepo({
      findDevueltasSla: vi.fn(async () => [row({ causa: "wrong_number", ancladaAt: new Date(NOW.getTime() - 6 * DIA) })]),
      escalarDevueltaSla: vi.fn(async () => false),
    });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 1 });
  });

  it("nada que procesar -> conteos en cero", async () => {
    const repo = fakeRepo({ findDevueltasSla: vi.fn(async () => []) });
    const res = await newService(repo).ejecutar(NOW);
    expect(res).toEqual({ evaluadas: 0, liberadas: 0, escaladas: 0, omitidas: 0 });
  });
});
