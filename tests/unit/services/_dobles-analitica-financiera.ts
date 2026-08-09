import { vi } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { CuboTemporal } from "@/lib/analytics/cubo-temporal";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ErrorLogger } from "@/lib/errors/logger";
import type {
  AgregadoCategoriaCaja,
  AgregadoCuboCategoriaCaja,
  IIngresosAnaliticaRepository,
} from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type {
  AgregadoTiendaLedger,
  TotalPorMetodoCierre,
} from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import type {
  AgregadoCuboTipo,
  CuentaMensajeroAlCorte,
  ICuentasPorPagarAnaliticaRepository,
  SaldoTiendaAlCorte,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import type {
  GrupoCierrePorEstado,
  SnapshotCierreAprobado,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import { AnaliticaFinancieraService } from "@/lib/services/AnaliticaFinancieraService";
import type {
  ImporteAnalitico,
  ImporteConNeto,
  ImporteSoloBruto,
} from "@/lib/types/analitica-financiera";

// Feature 127 / TANDA D — DOBLES DE LOS CUATRO REPOSITORIOS (R31).
//
// El servicio se construye con interfaces, asi que su suite entera corre SIN base de datos y sin
// `DATABASE_URL`. Estos dobles no son la base falsa de la TANDA C (`_fake-prisma-dinero.ts`, que
// ejecuta `where`/`groupBy` de verdad y sigue siendo la que juzga a los repositorios): aqui la
// frontera que se prueba es OTRA —lo que el servicio hace con lo que el repositorio le entrega—,
// y por eso el doble devuelve filas fijas y REGISTRA cada llamada.
//
// Registrar las llamadas no es adorno: R5 y R10 exigen que ante un dominio invalido NO se
// consulte nada, y eso solo se puede afirmar mirando el espia, no el resultado.

export interface DatosFinancieros {
  readonly caja: readonly AgregadoCategoriaCaja[];
  readonly porMetodo: readonly TotalPorMetodoCierre[];
  readonly porTienda: readonly AgregadoTiendaLedger[];
  readonly saldoTiendas: readonly SaldoTiendaAlCorte[];
  readonly cuentaMensajeros: readonly CuentaMensajeroAlCorte[];
  /* --- Feature 180: el material del desglose por cubo temporal ------------------------- */
  readonly cajaPorCubo: readonly AgregadoCuboCategoriaCaja[];
  readonly cuentaMensajerosPorCubo: readonly AgregadoCuboTipo[];
  readonly cuentaMensajerosAntes: readonly CuentaMensajeroAlCorte[];
  readonly porEstado: readonly GrupoCierrePorEstado[];
  readonly snapshots: readonly SnapshotCierreAprobado[];
  readonly ledger: readonly TotalLedgerPorOrigenCierre[];
}

const VACIO: DatosFinancieros = {
  caja: [],
  porMetodo: [],
  porTienda: [],
  saldoTiendas: [],
  cuentaMensajeros: [],
  cajaPorCubo: [],
  cuentaMensajerosPorCubo: [],
  cuentaMensajerosAntes: [],
  porEstado: [],
  snapshots: [],
  ledger: [],
};

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };

/** `now` fijo: el determinismo del DTO no puede depender del reloj (R28). */
export const AHORA = new Date("2026-08-02T15:00:00.000Z");

export function consultaDe(metricaId: string, raw: unknown = { rango: "dia" }): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(raw, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/* -------------------------------------------------------------------------- */
/* Feature 183 — leer un importe de la union discriminada, SIN apagar la union  */
/* -------------------------------------------------------------------------- */
//
// Desde ⟨D12⟩ (2026-08-04) `ImporteAnalitico` es `ImporteConNeto | ImporteSoloBruto` y `.neto`
// no se puede leer sin estrechar por `forma`. Un `as ImporteConNeto` en cada caso apagaria justo
// la comprobacion que la union existe para dar. Estos dos helpers NO apagan nada: AFIRMAN la
// forma antes de devolver, asi que si una metrica cambiara de forma sin querer, el caso que la
// lee se pone rojo con un mensaje que dice cual y cual llego.

/** El importe estrechado a `bruto_y_neto`, o un fallo con nombre. */
export function conNeto(importe: ImporteAnalitico, contexto = "el importe"): ImporteConNeto {
  if (importe.forma !== "bruto_y_neto") {
    throw new Error(`${contexto}: se esperaba forma "bruto_y_neto" y llego "${importe.forma}"`);
  }
  return importe;
}

/** El importe estrechado a `solo_bruto`, o un fallo con nombre. */
export function soloBruto(importe: ImporteAnalitico, contexto = "el importe"): ImporteSoloBruto {
  if (importe.forma !== "solo_bruto") {
    throw new Error(`${contexto}: se esperaba forma "solo_bruto" y llego "${importe.forma}"`);
  }
  return importe;
}

/* -------------------------------------------------------------------------- */
/* Feature 187 — EL REGISTRO DE ALCANCES DE LECTURA CONSISTENTE                 */
/* -------------------------------------------------------------------------- */
//
// POR QUE NO BASTA CON `vi.fn(async (fn) => fn(repo))`, que es lo primero que uno escribe.
//
// Con eso, el R1 de la 187 («las dos lecturas ocurren DENTRO de una lectura consistente») se
// «verificaria» comprobando que se llamo a una funcion — y ese test seguiria verde con un
// repositorio que abriera el alcance, lo cerrara acto seguido y consultara fuera. Es exactamente
// el test vacio que esta feature vino a no repetir.
//
// Asi que el registro apunta TRES cosas y en ORDEN: cuando se abre un alcance, cuando se cierra,
// y —en cada lectura— QUE alcance estaba abierto en ese instante (o ninguno). Con eso se puede
// afirmar que las dos lecturas de la caja cayeron dentro del MISMO alcance, que las tres de
// mensajeros cayeron en UNO solo, y que las metricas de fuera no abrieron ninguno.
//
// LO QUE NO REGISTRA, dicho para que nadie lo confunda: nada de Postgres. Que el nivel de
// aislamiento aterrice de verdad en la sesion lo mide el test de integracion I1; que el
// repositorio pida `RepeatableRead` lo mide el fake de Prisma. Este doble solo ve la FORMA de la
// composicion que hace el servicio.

/** Un evento del registro: apertura, cierre o lectura, con el alcance vigente. */
export interface EventoDeAlcance {
  readonly tipo: "abre" | "lee" | "cierra";
  /** El repositorio que abre/cierra, o el metodo que lee. */
  readonly nombre: string;
  /** Id del alcance vigente en ese instante; `null` = no habia ninguno abierto. */
  readonly alcance: number | null;
}

interface RegistroDeAlcances {
  readonly eventos: readonly EventoDeAlcance[];
  /** Cuantos alcances se abrieron en toda la consulta. */
  aperturas: () => number;
  /** Las lecturas, en orden, con el alcance en que cayo cada una. */
  lecturas: () => readonly EventoDeAlcance[];
  /** El alcance de cada lectura, en orden. `null` = leyo fuera de todo alcance. */
  alcancesDeLasLecturas: () => readonly (number | null)[];
  /** Marca una lectura. Lo llaman los dobles, no los tests. */
  leer: (nombre: string) => void;
  /** Abre un alcance y devuelve su id. */
  abrir: (nombre: string) => number;
  cerrar: (nombre: string, id: number) => void;
}

function registroDeAlcances(): RegistroDeAlcances {
  const eventos: EventoDeAlcance[] = [];
  const pila: number[] = [];
  let siguienteId = 0;
  const vigente = (): number | null => (pila.length === 0 ? null : pila[pila.length - 1]);

  return {
    eventos,
    aperturas: () => eventos.filter((e) => e.tipo === "abre").length,
    lecturas: () => eventos.filter((e) => e.tipo === "lee"),
    alcancesDeLasLecturas: () => eventos.filter((e) => e.tipo === "lee").map((e) => e.alcance),
    leer: (nombre) => {
      eventos.push({ tipo: "lee", nombre, alcance: vigente() });
    },
    abrir: (nombre) => {
      const id = siguienteId++;
      pila.push(id);
      eventos.push({ tipo: "abre", nombre, alcance: id });
      return id;
    },
    cerrar: (nombre, id) => {
      pila.pop();
      eventos.push({ tipo: "cierra", nombre, alcance: id });
    },
  };
}

export function armarServicio(datos: Partial<DatosFinancieros> = {}, umbral?: string) {
  const d = { ...VACIO, ...datos };
  const alcances = registroDeAlcances();

  // Las lecturas se declaran SUELTAS y luego se comparten entre el doble de fuera y el que se
  // entrega dentro del alcance. No es un rodeo: tienen que ser LOS MISMOS `vi.fn`, porque las
  // suites de la 127 y la 180 cuentan sobre ellos (`toHaveBeenCalledTimes(1)`,
  // `consultasHechas() === 2`). Entregar dentro del alcance un espia distinto dejaria aquellas
  // aserciones en cero y obligaria a reescribirlas, que es justo lo que T5.1 prohibe.
  const sumarPorCategoria = vi.fn(async () => {
    alcances.leer("sumarPorCategoria");
    return d.caja;
  });
  // Feature 180 — los DOS parametros se declaran aunque el doble devuelva filas fijas: sin
  // ellos, `mock.calls` queda tipado como `[]` y el test de coherencia (R22: los cubos que el
  // servicio pasa son EXACTAMENTE `trocear(consulta.rango)`) no tendria argumentos que mirar
  // sin un cast que apagaria justo lo que se quiere comprobar.
  const sumarPorCuboYCategoria = vi.fn(
    async (_consulta: ConsultaAnalitica, _cubos: readonly CuboTemporal[]) => {
      alcances.leer("sumarPorCuboYCategoria");
      return d.cajaPorCubo;
    },
  );

  /** Anidar alcances no se puede: el cliente transaccional de Prisma no ofrece `$transaction`. */
  const noAnidar = (): never => {
    throw new Error("doble: los alcances de lectura consistente no se anidan");
  };

  const lecturasDeIngresos = { sumarPorCategoria, sumarPorCuboYCategoria };
  const ingresos = {
    ...lecturasDeIngresos,
    enLecturaConsistente: async <T,>(
      fn: (repo: IIngresosAnaliticaRepository) => Promise<T>,
    ): Promise<T> => {
      const id = alcances.abrir("ingresos");
      try {
        return await fn({ ...lecturasDeIngresos, enLecturaConsistente: noAnidar });
      } finally {
        // En `finally` a proposito: si la lectura falla, el alcance se cierra igual y el registro
        // no queda con un alcance abierto para siempre, que taparia el siguiente caso.
        alcances.cerrar("ingresos", id);
      }
    },
  };

  const recaudo = {
    porMetodoDeCierresResueltos: vi.fn(async () => {
      alcances.leer("porMetodoDeCierresResueltos");
      return d.porMetodo;
    }),
    porTiendaDeLedger: vi.fn(async () => {
      alcances.leer("porTiendaDeLedger");
      return d.porTienda;
    }),
  };

  const saldoPorTiendaAlCorte = vi.fn(async () => {
    alcances.leer("saldoPorTiendaAlCorte");
    return d.saldoTiendas;
  });
  const cuentaPorPagarMensajerosAlCorte = vi.fn(async () => {
    alcances.leer("cuentaPorPagarMensajerosAlCorte");
    return d.cuentaMensajeros;
  });
  const cuentaPorPagarMensajerosPorCubo = vi.fn(
    async (_consulta: ConsultaAnalitica, _cubos: readonly CuboTemporal[]) => {
      alcances.leer("cuentaPorPagarMensajerosPorCubo");
      return d.cuentaMensajerosPorCubo;
    },
  );
  const cuentaPorPagarMensajerosAntesDe = vi.fn(async () => {
    alcances.leer("cuentaPorPagarMensajerosAntesDe");
    return d.cuentaMensajerosAntes;
  });

  const lecturasDeCuentasPorPagar = {
    saldoPorTiendaAlCorte,
    cuentaPorPagarMensajerosAlCorte,
    cuentaPorPagarMensajerosPorCubo,
    cuentaPorPagarMensajerosAntesDe,
  };
  const cuentasPorPagar = {
    ...lecturasDeCuentasPorPagar,
    enLecturaConsistente: async <T,>(
      fn: (repo: ICuentasPorPagarAnaliticaRepository) => Promise<T>,
    ): Promise<T> => {
      const id = alcances.abrir("cuentasPorPagar");
      try {
        return await fn({ ...lecturasDeCuentasPorPagar, enLecturaConsistente: noAnidar });
      } finally {
        alcances.cerrar("cuentasPorPagar", id);
      }
    },
  };

  const conciliacion = {
    contarCierresPorEstado: vi.fn(async () => {
      alcances.leer("contarCierresPorEstado");
      return d.porEstado;
    }),
    totalesDeCierresAprobados: vi.fn(async () => {
      alcances.leer("totalesDeCierresAprobados");
      return d.snapshots;
    }),
    sumarLedgerPorOrigenDeCierre: vi.fn(async () => {
      alcances.leer("sumarLedgerPorOrigenDeCierre");
      return d.ledger;
    }),
  };
  const logger: ErrorLogger = { logError: vi.fn() };

  const espias = [
    ingresos.sumarPorCategoria,
    ingresos.sumarPorCuboYCategoria,
    recaudo.porMetodoDeCierresResueltos,
    recaudo.porTiendaDeLedger,
    cuentasPorPagar.saldoPorTiendaAlCorte,
    cuentasPorPagar.cuentaPorPagarMensajerosAlCorte,
    cuentasPorPagar.cuentaPorPagarMensajerosPorCubo,
    cuentasPorPagar.cuentaPorPagarMensajerosAntesDe,
    conciliacion.contarCierresPorEstado,
    conciliacion.totalesDeCierresAprobados,
    conciliacion.sumarLedgerPorOrigenDeCierre,
  ];

  const servicio =
    umbral === undefined
      ? new AnaliticaFinancieraService(ingresos, recaudo, cuentasPorPagar, conciliacion, logger)
      : new AnaliticaFinancieraService(
          ingresos,
          recaudo,
          cuentasPorPagar,
          conciliacion,
          logger,
          umbral,
        );

  return {
    servicio,
    ingresos,
    recaudo,
    cuentasPorPagar,
    conciliacion,
    logger,
    /** Cuantas veces se le pregunto ALGO a CUALQUIER repositorio. */
    consultasHechas: () => espias.reduce((n, e) => n + e.mock.calls.length, 0),
    /**
     * Feature 187 — el registro de alcances. NO entra en `consultasHechas()` y eso es deliberado:
     * abrir una lectura consistente no es preguntarle nada a la base, y si contara, el
     * `consultasHechas() === 2` de la 180 pasaria a valer 3 y habria que reescribir una asercion
     * que esta feature se comprometio a no tocar.
     */
    alcances,
  };
}
