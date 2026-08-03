import { describe, it, expect, vi } from "vitest";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { MotivoDenegacion } from "@/lib/analytics/alcance";
import type { ErrorLogger } from "@/lib/errors/logger";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { AgregadoCategoriaCaja } from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type {
  AgregadoTiendaLedger,
  TotalPorMetodoCierre,
} from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import type {
  CuentaMensajeroAlCorte,
  SaldoTiendaAlCorte,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import type {
  GrupoCierrePorEstado,
  SnapshotCierreAprobado,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import { IDS_FINANCIERAS_SERVIDAS } from "@/lib/types/analitica-financiera";
import { armarServicio, AHORA } from "../services/_dobles-analitica-financiera";

// Feature 127 / T E.3 y E.4 — GUARDIA DE SEGURIDAD DEL BORDE. Es lo unico de la feature que ve
// un usuario real, y es por donde se filtran las cosas.
//
// E.3 / R12 / R42 / ⟨D9(c)⟩ — EL CUERPO DEL 403 NO DICE POR QUE.
// El dominio de `MotivoDenegacion` tiene SIETE valores y ninguno puede cruzar al cliente. No es
// cosmetica: con `metrica_desconocida` frente a `metrica_prohibida` un cliente enumera el
// catalogo entero y, preguntando con distintos roles, el mapa de permisos. El motivo integro va
// al registro del `ErrorLogger` —donde el operador si lo necesita— y solo ahi. Por eso el test
// comprueba las DOS mitades sobre los SIETE motivos: que la respuesta no lo lleva y que el
// registro si.
//
// E.4 / R14 — BARRIDO DE IDENTIDAD SOBRE LA CADENA SERIALIZADA COMPLETA.
// Se recorre `JSON.stringify` de la respuesta de las OCHO metricas buscando el uuid de un
// mensajero sembrado, y no se inspecciona campo por campo A PROPOSITO: lo que se escapa, se
// escapa por el campo que nadie penso en mirar —un `...fila` de mas, un objeto de depuracion,
// una clave anidada—. El uuid se siembra en TODAS las filas que los repositorios entregan, que
// es el escenario real contra el que R14 defiende: el repositorio trajo mas de lo que el DTO
// declara y el servicio no lo puede reenviar.
//
// La seudonimizacion (R38/R39 de la 122) es inalcanzable aqui: `adminTienda` es el unico rol con
// politica `seudonima` y tiene las ocho financieras `prohibido`. Por eso R14 no seudonimiza:
// PROHIBE el campo, que es mas fuerte y si es verificable.

/* -------------------------------------------------------------------------- */
/* E.3 — los siete motivos, ninguno en el cuerpo                               */
/* -------------------------------------------------------------------------- */

/**
 * Los siete literales, ESCRITOS A MANO. Derivarlos del modulo que se juzga haria que renombrar
 * uno siguiera pareciendo correcto; el `satisfies` ata la lista al tipo, asi que si el dominio
 * gana un octavo motivo esta lista deja de ser exhaustiva y el caso de cobertura lo dice.
 */
const MOTIVOS = [
  "sin_sesion",
  "rol_desconocido",
  "rol_sin_analitica",
  "sin_zona_asignada",
  "metrica_desconocida",
  "metrica_prohibida",
  "filtro_fuera_de_alcance",
] as const satisfies readonly MotivoDenegacion[];

interface CasoDenegado {
  readonly motivo: MotivoDenegacion;
  readonly actor: Actor | null;
  readonly metricaId: string;
  readonly raw: unknown;
}

const CASOS: readonly CasoDenegado[] = [
  { motivo: "sin_sesion", actor: null, metricaId: "egresos", raw: { rango: "dia" } },
  {
    motivo: "rol_desconocido",
    actor: { usuarioId: "u-raro", rol: "inventado" } as unknown as Actor,
    metricaId: "egresos",
    raw: { rango: "dia" },
  },
  {
    motivo: "rol_sin_analitica",
    actor: { usuarioId: "u-api", rol: "apiKey" } as unknown as Actor,
    metricaId: "egresos",
    raw: { rango: "dia" },
  },
  {
    // `entregas` es `acotado` para `adminSatelite`, y un satelite sin zona no tiene recorte
    // posible: se falla cerrado en vez de degradar a global o a tablero vacio.
    motivo: "sin_zona_asignada",
    actor: { usuarioId: "u-sat", rol: "adminSatelite", zonaId: null },
    metricaId: "entregas",
    raw: { rango: "dia" },
  },
  {
    motivo: "metrica_desconocida",
    actor: { usuarioId: "u-maestro", rol: "maestro", zonaId: null },
    metricaId: "metrica_que_no_existe",
    raw: { rango: "dia" },
  },
  {
    motivo: "metrica_prohibida",
    actor: { usuarioId: "t-propia", rol: "adminTienda", zonaId: null },
    metricaId: "egresos",
    raw: { rango: "dia" },
  },
  {
    // El actor pide EXPLICITAMENTE datos de otra tienda en una metrica que si ve.
    motivo: "filtro_fuera_de_alcance",
    actor: { usuarioId: "t-propia", rol: "adminTienda", zonaId: null },
    metricaId: "entregas",
    raw: { rango: "dia", tienda_id: ["t-ajena"] },
  },
];

/** Devuelve el motivo que se escapo en la cadena, o `null`. Es lo que los fixtures ejercitan. */
export function motivoFiltrado(serializada: string): string | null {
  return MOTIVOS.find((m) => serializada.includes(m)) ?? null;
}

async function ejecutarDenegado(caso: CasoDenegado) {
  const logError = vi.fn();
  const logger: ErrorLogger = { logError };
  const respuesta = await consultarMetricaFinanciera(caso.metricaId, caso.raw, {
    now: AHORA,
    logger,
    getActor: async () => caso.actor,
    service: armarServicio().servicio,
  });
  return { respuesta, logError };
}

describe("E.3 / R12 · el cuerpo del 403 es generico: `{ code: FORBIDDEN }` y nada mas", () => {
  for (const caso of CASOS) {
    it(`${caso.motivo}: responde forbidden sin decir por que`, async () => {
      const { respuesta } = await ejecutarDenegado(caso);
      // Igualdad ESTRICTA: no basta con que el motivo no aparezca, es que no hay ningun campo
      // de mas donde pudiera aparecer mañana.
      expect(respuesta).toEqual({ status: "forbidden", code: "FORBIDDEN" });
    });
  }

  it("y jamas se traduce a 200 con ceros ni con lista vacia", async () => {
    for (const caso of CASOS) {
      const { respuesta } = await ejecutarDenegado(caso);
      expect(respuesta.status, caso.motivo).not.toBe("ok");
      expect(JSON.stringify(respuesta), caso.motivo).not.toContain("0.00");
    }
  });
});

describe("E.3 / R42 · el motivo no cruza al cliente, y SI queda en el registro", () => {
  for (const caso of CASOS) {
    it(`${caso.motivo}: fuera de la respuesta, dentro del ErrorLogger`, async () => {
      const { respuesta, logError } = await ejecutarDenegado(caso);

      expect(motivoFiltrado(JSON.stringify(respuesta))).toBeNull();

      expect(logError).toHaveBeenCalledTimes(1);
      const registro = logError.mock.calls[0][0] as { motivo?: string };
      expect(registro.motivo).toBe(caso.motivo);
      // La otra mitad: el registro SI contiene el literal, o sea que la cadena de arriba no
      // esta vacia por casualidad — el motivo existia y viajo, pero por el canal correcto.
      expect(motivoFiltrado(JSON.stringify(registro))).toBe(caso.motivo);
    });
  }

  it("los SIETE motivos del dominio estan ejercitados, ninguno se queda sin caso", () => {
    expect([...new Set(CASOS.map((c) => c.motivo))].sort()).toEqual([...MOTIVOS].sort());
    expect(MOTIVOS).toHaveLength(7);
  });

  it("autocomprobacion: el detector encuentra el motivo si alguien lo propaga al cuerpo", () => {
    const filtrado = JSON.stringify({ status: "forbidden", code: "FORBIDDEN", motivo: "metrica_prohibida" });
    expect(motivoFiltrado(filtrado)).toBe("metrica_prohibida");
    expect(motivoFiltrado(JSON.stringify({ status: "forbidden", code: "FORBIDDEN" }))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* E.4 — el barrido de identidad sobre las ocho metricas                       */
/* -------------------------------------------------------------------------- */

/** El uuid sembrado. Cualquier aparicion suya en una respuesta financiera es una fuga (R14). */
const MENSAJERO_UUID = "9f1c7a52-4d3b-4a11-9c8e-2b6f0d5e7a34";

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro", zonaId: null };

/**
 * Devuelve la fila del repositorio CON un id de mensajero pegado.
 *
 * Es el escenario real: el repositorio trajo mas columnas de las que el DTO declara —un
 * `select` que se amplio, un `groupBy` con una clave de mas— y el servicio no puede reenviarlo.
 * El cast es deliberado: el tipo prohibe el campo (esa es la primera defensa, y ya la mide el
 * test de contratos), y aqui se comprueba la segunda, la de ejecucion.
 */
function conFuga<T extends object>(fila: T): T {
  return { ...fila, mensajeroId: MENSAJERO_UUID, mensajero_id: MENSAJERO_UUID } as T;
}

const CAJA: readonly AgregadoCategoriaCaja[] = [
  conFuga({ categoria: "ingreso_flete", tipo: "ingreso", suma: "1500.00" }),
  conFuga({ categoria: "egreso_indemnizacion", tipo: "egreso", suma: "250.00" }),
] as readonly AgregadoCategoriaCaja[];

const POR_METODO: readonly TotalPorMetodoCierre[] = [
  conFuga({ metodo: "efectivo", suma: "900.00" }),
  conFuga({ metodo: "simpe", suma: "100.00" }),
  conFuga({ metodo: "transferencia", suma: "0.00" }),
] as readonly TotalPorMetodoCierre[];

const POR_TIENDA: readonly AgregadoTiendaLedger[] = [
  conFuga({ tiendaId: "t-1", tipo: "credito", suma: "800.00" }),
  conFuga({ tiendaId: "t-2", tipo: "debito", suma: "50.00" }),
] as readonly AgregadoTiendaLedger[];

const SALDO_TIENDAS: readonly SaldoTiendaAlCorte[] = [
  conFuga({ tiendaId: "t-1", tipo: "credito", suma: "1200.00" }),
  conFuga({ tiendaId: "t-2", tipo: "debito", suma: "300.00" }),
] as readonly SaldoTiendaAlCorte[];

const CUENTA_MENSAJEROS: readonly CuentaMensajeroAlCorte[] = [
  conFuga({ tipo: "devengo", suma: "700.00" }),
  conFuga({ tipo: "pago", suma: "200.00" }),
] as readonly CuentaMensajeroAlCorte[];

const POR_ESTADO: readonly GrupoCierrePorEstado[] = [
  conFuga({
    nivel: "cierre_dia" as const,
    estado: "aprobado" as const,
    cantidad: 1,
    totales: { efectivo: "900.00", simpe: "0.00", transferencia: "0.00", general: "900.00" },
    fechadoPor: "resuelto_at" as const,
  }),
  conFuga({
    nivel: "cierre_dia" as const,
    estado: "solicitado" as const,
    cantidad: 1,
    totales: { efectivo: "400.00", simpe: "0.00", transferencia: "0.00", general: "400.00" },
    fechadoPor: "solicitado_at" as const,
  }),
] as readonly GrupoCierrePorEstado[];

const SNAPSHOTS: readonly SnapshotCierreAprobado[] = [
  conFuga({ cierreId: "c-aprobado-1", totalGeneral: "900.00" }),
] as readonly SnapshotCierreAprobado[];

// 850 contra los 900 del snapshot: el cierre sale DESCUADRADO a proposito, para que su id
// aparezca en `cierresDescuadrados` y el barrido tenga que mirar tambien esa lista.
const LEDGER: readonly TotalLedgerPorOrigenCierre[] = [
  conFuga({
    ledger: "wallet_tienda_movimiento" as const,
    cierreId: "c-aprobado-1",
    tipo: "credito" as const,
    suma: "850.00",
  }),
] as readonly TotalLedgerPorOrigenCierre[];

const DATOS_SEMBRADOS = {
  caja: CAJA,
  porMetodo: POR_METODO,
  porTienda: POR_TIENDA,
  saldoTiendas: SALDO_TIENDAS,
  cuentaMensajeros: CUENTA_MENSAJEROS,
  porEstado: POR_ESTADO,
  snapshots: SNAPSHOTS,
  ledger: LEDGER,
};

async function respuestaDe(metricaId: string) {
  const logError = vi.fn();
  return {
    respuesta: await consultarMetricaFinanciera(
      metricaId,
      { rango: "dia" },
      {
        now: AHORA,
        logger: { logError },
        getActor: async () => MAESTRO,
        service: armarServicio(DATOS_SEMBRADOS).servicio,
      },
    ),
    logError,
  };
}

describe("E.4 / R14 · ninguna respuesta financiera contiene un id de mensajero", () => {
  for (const metricaId of IDS_FINANCIERAS_SERVIDAS) {
    it(`${metricaId}: el uuid sembrado no aparece en la cadena serializada COMPLETA`, async () => {
      const { respuesta } = await respuestaDe(metricaId);

      expect(respuesta.status, metricaId).toBe("ok");
      const serializada = JSON.stringify(respuesta);
      expect(serializada, metricaId).not.toContain(MENSAJERO_UUID);
      // Ni el uuid, ni el nombre del campo por el que entraria.
      expect(serializada.toLowerCase(), metricaId).not.toContain("mensajeroid");
      expect(serializada.toLowerCase(), metricaId).not.toContain("mensajero_id");
    });
  }

  it("el barrido cubre EXACTAMENTE las ocho financieras", () => {
    expect(IDS_FINANCIERAS_SERVIDAS).toHaveLength(8);
  });

  it("no pasa por conjunto vacio: las ocho respuestas llevan dinero de verdad", async () => {
    for (const metricaId of IDS_FINANCIERAS_SERVIDAS) {
      const { respuesta } = await respuestaDe(metricaId);
      const serializada = JSON.stringify(respuesta);
      // Un importe distinto de cero en alguna parte de la respuesta. Si los dobles no hubieran
      // sembrado nada, cada caso de arriba estaria barriendo un DTO vacio y pasaria solo.
      expect(serializada, metricaId).toMatch(/"[^"]*":"-?\d*[1-9]\d*\.\d{2}"/);
      expect(serializada.length, metricaId).toBeGreaterThan(200);
    }
  });

  it("y el material sembrado SI llevaba el uuid: el fixture no es inocuo", () => {
    const material = JSON.stringify(DATOS_SEMBRADOS);
    expect(material).toContain(MENSAJERO_UUID);
    // Cuenta las filas contaminadas para que reducir el fixture a una sola se note.
    expect(material.split(MENSAJERO_UUID).length - 1).toBeGreaterThanOrEqual(24);
  });

  it("autocomprobacion: una respuesta que reenviara las filas del repositorio SI se detecta", () => {
    // El fallo concreto contra el que esto defiende: un `...fila` de mas en el servicio.
    const fugada = JSON.stringify({
      status: "ok",
      datos: { metricaId: "cuenta_por_pagar_mensajero", filas: CUENTA_MENSAJEROS },
    });
    expect(fugada).toContain(MENSAJERO_UUID);
  });

  it("los ids que SI son legitimos siguen llegando: tienda y cierre no son personas", async () => {
    const tienda = JSON.stringify((await respuestaDe("cuenta_por_pagar_tienda")).respuesta);
    expect(tienda).toContain("t-1");

    const conciliacion = JSON.stringify((await respuestaDe("conciliacion_cierres")).respuesta);
    expect(conciliacion).toContain("c-aprobado-1");
  });
});
