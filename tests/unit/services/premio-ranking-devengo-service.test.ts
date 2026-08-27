import { describe, it, expect, vi } from "vitest";
import { RolValue } from "@prisma/client";
import { PremioRankingDevengoService } from "@/lib/services/PremioRankingDevengoService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CierreDelDiaRow } from "@/lib/interfaces/repositories/ICierreDelDiaRepository";
import type {
  CrearPagoMensajeroInput,
  PremioRegistradoRow,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { PodioFilaConFecha } from "@/lib/interfaces/repositories/IRankingSnapshotRepository";
import type { MovimientoDeCajaDePremio } from "@/lib/interfaces/services/ICajaPremioRankingFeedService";
import type { PremioTx } from "@/lib/interfaces/services/IPremioRankingDevengoService";

// Feature 293 (T4.2, design §7) — el servicio del PREMIO DEL RANKING, con dobles.
//
// Los dobles modelan la SEMANTICA de las barreras de la base, no un `if` del test:
//   - el libro devuelve 0 filas insertadas cuando la clave `(mensajero, premio_dia, categoria)`
//     ya existe, que es lo que hace `ON CONFLICT DO NOTHING`;
//   - la transaccion revierte de verdad lo escrito si la funcion lanza.
// Lo que un doble NO puede demostrar es que el indice EXISTA y que su predicado sea el correcto:
// eso vive en `tests/integration/db/premio-ranking-idempotencia.test.ts`, contra Postgres.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: RolValue.maestro };
const ADMIN: Actor = { usuarioId: "u-admin", rol: RolValue.admin };
const DIA = new Date("2026-08-26T00:00:00.000Z");

/**
 * El `tx` que el runner entrega. Es un objeto IDENTIFICABLE a proposito (revision de la 293,
 * m4): deja afirmar que lo que ocurre dentro de la transaccion —tambien las LECTURAS— va por
 * ESA transaccion, y no por el cliente propio de un repositorio, que es otra conexion.
 */
const TX_DE_LA_TRANSACCION = { soyLaTransaccion: true } as unknown as PremioTx;

function fila(over: Partial<PodioFilaConFecha> = {}): PodioFilaConFecha {
  return {
    filaId: "f1",
    posicion: 1,
    mensajeroId: "m1",
    mensajeroNombre: "Kevin Rojas",
    entregadas: 0,
    asignadas: 21,
    premioMonto: "5000.00",
    premioDescripcion: "Bono por buen rendimiento",
    fecha: DIA,
    ...over,
  };
}

const CIERRE_APROBADO: CierreDelDiaRow = {
  cierreId: "c1",
  estado: "aprobado",
  solicitadoAt: new Date("2026-08-27T02:00:00.000Z"),
};

interface Opciones {
  podio?: PodioFilaConFecha[] | null;
  filaPorId?: PodioFilaConFecha | null;
  cierre?: CierreDelDiaRow | null;
  /** Filas YA escritas en el libro para ese (mensajero, dia). Es la memoria de la base. */
  registradas?: PremioRegistradoRow[];
  /** Hace que la escritura en la CAJA devuelva 0 (el caso imposible-en-teoria de R20). */
  cajaDevuelveCero?: boolean;
  /** Hace explotar la escritura de la caja: R20 exige que no quede la fila del libro. */
  reventarCaja?: boolean;
}

function dobles(opciones: Opciones = {}) {
  const log: string[] = [];
  /** Lo escrito por la transaccion EN CURSO; solo se confirma si no lanza (R20). */
  let pendientes: Array<CrearPagoMensajeroInput | MovimientoDeCajaDePremio> = [];
  const confirmadoLibro: CrearPagoMensajeroInput[] = [];
  const confirmadoCaja: MovimientoDeCajaDePremio[] = [];
  const libroCommiteado: CrearPagoMensajeroInput[] = [];

  const registradas = opciones.registradas ?? [];
  /** El indice unico parcial, modelado como DATO: la clave es (mensajero, dia, categoria). */
  const clavesUsadas = new Set(
    registradas.map((r) => `${r.premioDia.toISOString()}|${r.categoria}`),
  );

  const snapshotRepo = {
    listarPodioDeFecha: vi.fn(async () => {
      log.push("leer:podio");
      return opciones.podio === undefined ? [fila()] : opciones.podio;
    }),
    obtenerFilaDelPodio: vi.fn(async () => {
      log.push("leer:fila");
      return opciones.filaPorId === undefined ? fila() : opciones.filaPorId;
    }),
  };

  const cierreRepo = {
    resolverCierreDelDia: vi.fn(async () => {
      log.push("leer:cierre");
      return opciones.cierre === undefined ? CIERRE_APROBADO : opciones.cierre;
    }),
  };

  const libroRepo = {
    crearMovimientos: vi.fn(async (_tx: PremioTx, movs: CrearPagoMensajeroInput[]) => {
      log.push("escribir:libro");
      let n = 0;
      for (const m of movs) {
        const clave = `${(m.premioDia as Date).toISOString()}|${m.categoria}`;
        if (clavesUsadas.has(clave)) continue; // ON CONFLICT DO NOTHING
        clavesUsadas.add(clave);
        pendientes.push(m);
        confirmadoLibro.push(m);
        n += 1;
      }
      return n;
    }),
    // La firma lleva los tres parametros a proposito: sin ellos `mock.calls` no guardaria el
    // `tx` y la asercion de m4 no podria distinguir «leyo por la transaccion» de «leyo por fuera».
    listarPremiosPorDias: vi.fn(async (_m: string, _dias: Date[], _tx?: PremioTx) => {
      log.push("leer:registradas");
      return [...registradas, ...libroCommiteado.map(aFilaRegistrada)];
    }),
  };

  const caja = {
    emitirEgresoPremio: vi.fn(async (_tx: PremioTx, mov: MovimientoDeCajaDePremio) => {
      log.push("escribir:caja");
      if (opciones.reventarCaja) throw new Error("boom: la caja dijo que no");
      if (opciones.cajaDevuelveCero) return 0;
      pendientes.push(mov);
      confirmadoCaja.push(mov);
      return 1;
    }),
    reversarEgresoPremio: vi.fn(async (_tx: PremioTx, mov: MovimientoDeCajaDePremio) => {
      log.push("reversar:caja");
      if (opciones.reventarCaja) throw new Error("boom: la caja dijo que no");
      if (opciones.cajaDevuelveCero) return 0;
      pendientes.push(mov);
      confirmadoCaja.push(mov);
      return 1;
    }),
  };

  /** Transaccion con reversion REAL: si `fn` lanza, lo apuntado se descarta. */
  const runTransaction = async <T,>(fn: (tx: PremioTx) => Promise<T>): Promise<T> => {
    pendientes = [];
    log.push("tx:abrir");
    try {
      const r = await fn(TX_DE_LA_TRANSACCION);
      log.push("tx:commit");
      for (const p of pendientes) {
        if ("categoria" in p) libroCommiteado.push(p);
      }
      return r;
    } catch (e) {
      log.push("tx:rollback");
      for (const p of pendientes) {
        if ("categoria" in p) {
          const i = confirmadoLibro.indexOf(p);
          if (i >= 0) confirmadoLibro.splice(i, 1);
          clavesUsadas.delete(`${(p.premioDia as Date).toISOString()}|${p.categoria}`);
        } else {
          const i = confirmadoCaja.indexOf(p);
          if (i >= 0) confirmadoCaja.splice(i, 1);
        }
      }
      throw e;
    }
  };

  const service = new PremioRankingDevengoService(
    snapshotRepo,
    cierreRepo,
    libroRepo,
    caja,
    runTransaction,
  );
  return { service, snapshotRepo, cierreRepo, libroRepo, caja, log, confirmadoLibro, confirmadoCaja };
}

function aFilaRegistrada(m: CrearPagoMensajeroInput): PremioRegistradoRow {
  return {
    categoria: m.categoria as "premio_ranking" | "ajuste_pago",
    premioDia: m.premioDia as Date,
    monto: m.monto,
    cierreId: m.origenId,
    fechaMovimiento: new Date("2026-08-27T15:00:00.000Z"),
  };
}

const PREMIO_YA_REGISTRADO: PremioRegistradoRow = {
  categoria: "premio_ranking",
  premioDia: DIA,
  monto: "5000.00",
  cierreId: "c1",
  fechaMovimiento: new Date("2026-08-27T15:00:00.000Z"),
};

const COMPENSACION: PremioRegistradoRow = {
  categoria: "ajuste_pago",
  premioDia: DIA,
  monto: "5000.00",
  cierreId: "c1",
  fechaMovimiento: new Date("2026-08-27T16:00:00.000Z"),
};

// ── R2: permisos ────────────────────────────────────────────────────────────────────────────

describe("R2 — sin acceso total: `forbidden` ANTES de leer o escribir nada", () => {
  const SIN_ACCESO: Actor[] = [
    { usuarioId: "m1", rol: RolValue.mensajero },
    { usuarioId: "t1", rol: RolValue.adminTienda },
    { usuarioId: "s1", rol: RolValue.adminSatelite },
  ];

  it("los TRES metodos responden `forbidden` y no tocan un solo repositorio", async () => {
    for (const actor of SIN_ACCESO) {
      const d = dobles();

      expect(await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, actor)).toEqual({
        status: "forbidden",
      });
      expect(await d.service.registrarPremio({ filaId: "f1" }, actor)).toEqual({
        status: "forbidden",
      });
      expect(
        await d.service.anularPremio({ filaId: "f1", motivo: "error" }, actor),
      ).toEqual({ status: "forbidden" });

      // Ni un nombre, ni un monto, ni una consulta: el log tiene que estar VACIO.
      expect(d.log).toEqual([]);
    }
  });

  it("`maestro` y `admin` tienen los dos acceso total (paridad de la 94)", async () => {
    for (const actor of [MAESTRO, ADMIN]) {
      const d = dobles();
      const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, actor);
      expect(r.status).toBe("ok");
    }
  });
});

// ── R4/R5/R6/R7/R9: la lectura del podio ────────────────────────────────────────────────────

describe("R4/R5/R6/R9 — el podio de un dia con el estado de cada premio", () => {
  it("R6: una fecha sin snapshot devuelve `hayPodio: false` y ninguna fila", async () => {
    const d = dobles({ podio: null });

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    expect(r).toEqual({ status: "ok", fecha: "2026-08-26", hayPodio: false, filas: [] });
    // Y no se pregunta por el cierre de nadie: no hay fila que imputar.
    expect(d.cierreRepo.resolverCierreDelDia).not.toHaveBeenCalled();
  });

  it("R5: `entregadas / asignadas` viajan SIEMPRE, tambien el `0 / 21` del 26/08", async () => {
    const d = dobles();

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.filas[0]).toMatchObject({ entregadas: 0, asignadas: 21 });
  });

  it("R4/R15: el nombre y el monto son los CONGELADOS, y el monto es STRING", async () => {
    const d = dobles();

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.filas[0]).toMatchObject({
      mensajeroNombre: "Kevin Rojas",
      premioMonto: "5000.00",
      premioDescripcion: "Bono por buen rendimiento",
    });
    expect(typeof r.filas[0]!.premioMonto).toBe("string");
  });

  it("R7: sin premio (null) o con premio CERO -> `sin_premio`, sin consultar el cierre", async () => {
    for (const monto of [null, "0.00", "0"]) {
      const d = dobles({ podio: [fila({ premioMonto: monto })] });

      const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

      if (r.status !== "ok") throw new Error("esperaba ok");
      expect(r.filas[0]!.estado).toBe("sin_premio");
      expect(d.cierreRepo.resolverCierreDelDia).not.toHaveBeenCalled();
    }
  });

  it("R11: sin cierre de ese dia -> `sin_cierre` (y `cierreEstado` en null)", async () => {
    const d = dobles({ cierre: null });

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.filas[0]).toMatchObject({ estado: "sin_cierre", cierreEstado: null });
  });

  it("R12: cierre no aprobado -> `cierre_no_aprobado` NOMBRANDO el estado", async () => {
    for (const estado of ["solicitado", "rechazado", "vencido"]) {
      const d = dobles({ cierre: { ...CIERRE_APROBADO, estado } });

      const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

      if (r.status !== "ok") throw new Error("esperaba ok");
      expect(r.filas[0]).toMatchObject({ estado: "cierre_no_aprobado", cierreEstado: estado });
    }
  });

  it("todo listo -> `no_registrado`", async () => {
    const d = dobles();

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.filas[0]!.estado).toBe("no_registrado");
  });

  it("R9: con el premio escrito -> `registrado`; con su compensacion -> `anulado`", async () => {
    const registrado = dobles({ registradas: [PREMIO_YA_REGISTRADO] });
    const anulado = dobles({ registradas: [PREMIO_YA_REGISTRADO, COMPENSACION] });

    const a = await registrado.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);
    const b = await anulado.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (a.status !== "ok" || b.status !== "ok") throw new Error("esperaba ok");
    expect(a.filas[0]!.estado).toBe("registrado");
    expect(b.filas[0]!.estado).toBe("anulado");
    // Lo ya escrito NO se re-deriva: no hace falta preguntar por el cierre.
    expect(registrado.cierreRepo.resolverCierreDelDia).not.toHaveBeenCalled();
    expect(anulado.cierreRepo.resolverCierreDelDia).not.toHaveBeenCalled();
  });

  it("las tres posiciones salen en el orden en que el repositorio las da (posicion asc)", async () => {
    const d = dobles({
      podio: [
        fila({ filaId: "f1", posicion: 1 }),
        fila({ filaId: "f2", posicion: 2, mensajeroId: "m2", premioMonto: null }),
        fila({ filaId: "f3", posicion: 3, mensajeroId: "m3", premioMonto: "2000.00" }),
      ],
    });

    const r = await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.filas.map((f) => f.posicion)).toEqual([1, 2, 3]);
    expect(r.filas.map((f) => f.estado)).toEqual(["no_registrado", "sin_premio", "no_registrado"]);
  });
});

// ── R10-R23: el registro ────────────────────────────────────────────────────────────────────

describe("R10/R14/R15/R16/R22/R23 — lo que el registro ESCRIBE", () => {
  it("escribe UN devengo `premio_ranking` con el monto congelado, imputado al cierre", async () => {
    const d = dobles();

    const r = await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(r).toEqual({ status: "ok", monto: "5000.00", cierreId: "c1" });
    expect(d.confirmadoLibro).toHaveLength(1);
    expect(d.confirmadoLibro[0]).toEqual({
      mensajeroId: "m1", // R16: del PODIO, no del input
      tipo: "devengo", // R14: sube la cuenta por pagar
      categoria: "premio_ranking", // R14: categoria PROPIA, no `ajuste_devengo`
      monto: "5000.00", // R15: el CONGELADO
      origenTipo: "cierre_dia", // R10: cuelga de SU cierre y se ve bajo el en el desglose
      origenId: "c1",
      premioDia: DIA, // R17: la guarda (mensajero, dia) vive aqui
      descripcion: "Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento",
      registradoPor: "u-maestro", // R22: quien lo registro
    });
  });

  it("R23: NO se pasa `fechaMovimiento` — el movimiento se fecha en el instante del registro", async () => {
    const d = dobles();

    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(d.confirmadoLibro[0]).not.toHaveProperty("fechaMovimiento");
  });

  it("R22: la descripcion nombra fecha, posicion y la descripcion CONGELADA del premio", async () => {
    const d = dobles({ filaPorId: fila({ posicion: 3, premioDescripcion: "Tercer puesto" }) });

    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(d.confirmadoLibro[0]!.descripcion).toBe(
      "Premio del ranking 2026-08-26 · posición 3 · Tercer puesto",
    );
  });

  it("sin descripcion congelada, no se inventa un texto: se omite ese tramo", async () => {
    const d = dobles({ filaPorId: fila({ premioDescripcion: null }) });

    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(d.confirmadoLibro[0]!.descripcion).toBe("Premio del ranking 2026-08-26 · posición 1");
  });

  it("R15: el premio VIGENTE no interviene — el servicio no tiene por donde leerlo", async () => {
    // Se comprueba por CONSTRUCCION: sus cinco dependencias son las de este `dobles()` y ninguna
    // es `IPremioRankingRepository`. Si alguien la añadiera, este test dejaria de compilar.
    const d = dobles({ filaPorId: fila({ premioMonto: "1234.56" }) });

    const r = await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(r).toMatchObject({ monto: "1234.56" });
    expect(d.confirmadoLibro[0]!.monto).toBe("1234.56");
  });

  it("R20: el egreso de caja va en la MISMA transaccion, DESPUES del devengo", async () => {
    const d = dobles();

    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(d.log).toEqual([
      "leer:fila",
      "leer:cierre",
      "tx:abrir",
      "escribir:libro",
      "escribir:caja",
      "tx:commit",
    ]);
    expect(d.confirmadoCaja[0]).toEqual({
      filaId: "f1",
      monto: "5000.00",
      descripcion: "Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento",
      registradoPor: "u-maestro",
    });
  });

  it("R20: si la caja falla, NO queda la fila del libro", async () => {
    const d = dobles({ reventarCaja: true });

    await expect(d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).rejects.toThrow("boom");

    expect(d.confirmadoLibro).toHaveLength(0);
    expect(d.confirmadoCaja).toHaveLength(0);
    expect(d.log).toContain("tx:rollback");
  });

  it("R20: si el egreso cae en DO NOTHING, se revienta en vez de devolver `ok`", async () => {
    // Es imposible en el camino real —el devengo se acaba de escribir—, pero devolver `ok` con la
    // caja sin cargar seria dinero que sale sin registro: la familia de fallos mudos que esta
    // ficha persigue.
    const d = dobles({ cajaDevuelveCero: true });

    await expect(d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).rejects.toThrow(
      /egreso de caja no/,
    );
    expect(d.confirmadoLibro).toHaveLength(0);
  });
});

describe("R7/R11/R12/R18/R32 — los desenlaces del registro que NO escriben", () => {
  it("la fila no existe -> `no_encontrado`, sin abrir transaccion", async () => {
    const d = dobles({ filaPorId: null });

    expect(await d.service.registrarPremio({ filaId: "fantasma" }, MAESTRO)).toEqual({
      status: "no_encontrado",
    });
    expect(d.log).toEqual(["leer:fila"]);
  });

  it("R7: la fila no tiene premio -> `sin_premio` aunque se pida, y sin escribir nada", async () => {
    for (const monto of [null, "0.00"]) {
      const d = dobles({ filaPorId: fila({ premioMonto: monto }) });

      expect(await d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).toEqual({
        status: "sin_premio",
      });
      expect(d.confirmadoLibro).toHaveLength(0);
      expect(d.cierreRepo.resolverCierreDelDia).not.toHaveBeenCalled();
    }
  });

  it("R11: sin cierre de ese dia -> `sin_cierre`, causa EXACTA y sin escribir", async () => {
    const d = dobles({ cierre: null });

    expect(await d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).toEqual({
      status: "sin_cierre",
    });
    expect(d.log).toEqual(["leer:fila", "leer:cierre"]);
  });

  it("R12: cierre no aprobado -> `cierre_no_aprobado` con el estado dentro", async () => {
    const d = dobles({ cierre: { ...CIERRE_APROBADO, estado: "solicitado" } });

    expect(await d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).toEqual({
      status: "cierre_no_aprobado",
      estado: "solicitado",
    });
    expect(d.confirmadoLibro).toHaveLength(0);
  });

  it("R18: el reintento responde `ya_registrado`, SIN segunda fila y SIN error", async () => {
    const d = dobles();

    const primero = await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);
    const segundo = await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(primero).toMatchObject({ status: "ok" });
    expect(segundo).toEqual({ status: "ya_registrado" });
    expect(d.confirmadoLibro).toHaveLength(1); // una sola fila en el libro
    expect(d.confirmadoCaja).toHaveLength(1); // y un solo egreso en la caja
  });

  it("R32: tras anular, registrar de nuevo responde `anulado` (NO `ya_registrado`)", async () => {
    // La pantalla tiene que poder decir la verdad: el cupo (mensajero, dia) esta consumido y no
    // se puede reponer (Q2, cerrada por el leader).
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO, COMPENSACION] });

    expect(await d.service.registrarPremio({ filaId: "f1" }, MAESTRO)).toEqual({
      status: "anulado",
    });
    expect(d.confirmadoLibro).toHaveLength(0);
    expect(d.caja.emitirEgresoPremio).not.toHaveBeenCalled();
  });

  it("m4: esa relectura va POR LA TRANSACCION, no por el cliente del repositorio", async () => {
    // Dentro de un bloque transaccional, leer por el cliente propio del repositorio es OTRA
    // conexion: no ve lo que la transaccion en curso lleva escrito. Hoy esta rama corre sin nada
    // escrito por ella —por eso el codigo anterior no movia un colon—, pero la diferencia queda
    // MEDIDA en vez de razonada: el dia que la relectura se mueva detras de una escritura, el
    // fallo seria mudo y sobre dinero.
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO, COMPENSACION] });

    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);

    expect(d.libroRepo.listarPremiosPorDias).toHaveBeenCalledTimes(1);
    expect(d.libroRepo.listarPremiosPorDias).toHaveBeenCalledWith(
      "m1",
      [DIA],
      TX_DE_LA_TRANSACCION,
    );
  });

  it("m4 (contraprueba): la lectura del podio ocurre FUERA y sigue SIN transaccion", async () => {
    // Sin esto, «pasa el tx siempre» pasaria por bueno: el listado no esta en ninguna
    // transaccion y abrir una para leer tres filas seria peor, no mejor.
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO] });

    await d.service.listarPremiosDelDia({ fecha: "2026-08-26" }, MAESTRO);

    expect(d.libroRepo.listarPremiosPorDias).toHaveBeenCalledWith("m1", [DIA]);
  });

  it("R19: dos DIAS de podio distintos imputados al MISMO cierre se registran los dos", async () => {
    // La unicidad es por (mensajero, dia), NUNCA por cierre: es la medicion que descarta la
    // alternativa B del design (`cierre_dia` no tiene ningun indice unico, asi que un cierre
    // puede arrastrar dos dias de trabajo).
    const otroDia = new Date("2026-08-25T00:00:00.000Z");
    const d = dobles();
    await d.service.registrarPremio({ filaId: "f1" }, MAESTRO);
    d.snapshotRepo.obtenerFilaDelPodio.mockResolvedValue(
      fila({ filaId: "f2", fecha: otroDia, posicion: 2 }),
    );

    const segundo = await d.service.registrarPremio({ filaId: "f2" }, MAESTRO);

    expect(segundo).toMatchObject({ status: "ok", cierreId: "c1" });
    expect(d.confirmadoLibro).toHaveLength(2);
    expect(d.confirmadoLibro.map((m) => m.premioDia)).toEqual([DIA, otroDia]);
    expect(d.confirmadoLibro.map((m) => m.origenId)).toEqual(["c1", "c1"]); // el MISMO cierre
  });
});

// ── R29-R33: la anulacion ───────────────────────────────────────────────────────────────────

describe("R29/R30/R31/R33 — la anulacion", () => {
  it("escribe la compensacion con el MISMO monto, el MISMO cierre y el MISMO `premio_dia`", async () => {
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO] });

    const r = await d.service.anularPremio({ filaId: "f1", motivo: "Se pago por fuera" }, MAESTRO);

    expect(r).toEqual({ status: "ok" });
    expect(d.confirmadoLibro).toEqual([
      {
        mensajeroId: "m1",
        tipo: "pago", // baja la cuenta por pagar exactamente lo que el devengo la subio
        categoria: "ajuste_pago",
        monto: "5000.00", // efecto neto CERO
        origenTipo: "cierre_dia",
        origenId: "c1", // el MISMO cierre: lo pagable de ESE cierre baja (R33)
        premioDia: DIA,
        descripcion:
          "Anulación del premio del ranking 2026-08-26 · posición 1 · Se pago por fuera",
        registradoPor: "u-maestro",
      },
    ]);
  });

  it("R30: el motivo queda REGISTRADO en el movimiento compensatorio", async () => {
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO] });

    await d.service.anularPremio({ filaId: "f1", motivo: "Duplicado con el del dia 25" }, MAESTRO);

    expect(d.confirmadoLibro[0]!.descripcion).toContain("Duplicado con el del dia 25");
  });

  it("R29: el reverso de caja va en la MISMA transaccion, y si falla no queda la compensacion", async () => {
    const ok = dobles({ registradas: [PREMIO_YA_REGISTRADO] });
    await ok.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO);
    expect(ok.log).toEqual([
      "leer:fila",
      "leer:registradas",
      "tx:abrir",
      "escribir:libro",
      "reversar:caja",
      "tx:commit",
    ]);
    expect(ok.confirmadoCaja).toHaveLength(1);

    const roto = dobles({ registradas: [PREMIO_YA_REGISTRADO], reventarCaja: true });
    await expect(
      roto.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO),
    ).rejects.toThrow("boom");
    expect(roto.confirmadoLibro).toHaveLength(0);
  });

  it("R21: la anulacion NO toca la fila original — solo AÑADE", async () => {
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO] });

    await d.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO);

    // El unico escritor invocado es `crearMovimientos`: no existe ni un `update` ni un `delete`
    // en el camino, porque el repositorio no se los ofrece al servicio.
    expect(Object.keys(d.libroRepo)).toEqual(["crearMovimientos", "listarPremiosPorDias"]);
    expect(d.libroRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("sin premio registrado -> `no_registrado`, sin escribir", async () => {
    const d = dobles({ registradas: [] });

    expect(await d.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO)).toEqual({
      status: "no_registrado",
    });
    expect(d.confirmadoLibro).toHaveLength(0);
  });

  it("R31: la segunda anulacion responde `ya_anulado`, sin segunda compensacion y sin error", async () => {
    const d = dobles({ registradas: [PREMIO_YA_REGISTRADO] });

    const primera = await d.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO);
    const segunda = await d.service.anularPremio({ filaId: "f1", motivo: "x" }, MAESTRO);

    expect(primera).toEqual({ status: "ok" });
    expect(segunda).toEqual({ status: "ya_anulado" });
    expect(d.confirmadoLibro).toHaveLength(1);
    expect(d.confirmadoCaja).toHaveLength(1);
  });

  it("la fila del podio no existe -> `no_encontrado`", async () => {
    const d = dobles({ filaPorId: null });

    expect(await d.service.anularPremio({ filaId: "x", motivo: "x" }, MAESTRO)).toEqual({
      status: "no_encontrado",
    });
  });
});
