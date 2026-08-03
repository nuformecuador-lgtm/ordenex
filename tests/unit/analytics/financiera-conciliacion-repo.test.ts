import { describe, it, expect } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { ConciliacionCierresAnaliticaRepository } from "@/lib/repositories/ConciliacionCierresAnaliticaRepository";
import {
  fakePrismaDinero,
  type FilaCaja,
  type FilaCierreBodega,
  type FilaCierreDia,
  type FilaLedgerMensajero,
  type FilaLedgerTienda,
} from "./_fake-prisma-dinero";

// Feature 127 / T C.4 — `ConciliacionCierresAnaliticaRepository`: R22, R23, R25, R39, R14, R28.
//
// Los tres "hecho cuando" de la tarea son mutaciones, y los tres se miden aqui:
//   1. un AJUSTE MANUAL dentro del rango no se cuenta como descuadre — el lado ledger se filtra
//      por `origen_tipo`/`origen_id`, no por ventana temporal;
//   2. un `cierre_bodega` que consolida tres `cierre_dia` NO duplica el dinero — los dos niveles
//      salen por separado y nadie los funde;
//   3. el cierre `solicitado` recibe `fechadoPor: "solicitado_at"` — la doble coordenada es un
//      dato de la fila, no un sobreentendido.
//
// Y dos que la tarea no nombra pero que son la otra mitad de ⟨D2(b)⟩: un aprobado resuelto AYER
// no entra aunque se solicitara hoy, y un rechazado solicitado AYER no entra aunque se resolviera
// hoy. Sin esos dos casos, «fechar por resuelto_at» y «fechar por solicitado_at» se podrian
// invertir sin que nada se pusiera rojo.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-08-02T15:00:00.000Z");
const DESDE = new Date("2026-08-02T06:00:00.000Z");
const HASTA = new Date("2026-08-03T06:00:00.000Z");
const DENTRO = new Date("2026-08-02T14:00:00.000Z");
const DENTRO_TARDE = new Date("2026-08-02T20:00:00.000Z");
const AYER = new Date("2026-08-01T14:00:00.000Z");
const ANTEAYER = new Date("2026-07-31T14:00:00.000Z");

/** Un uuid de mensajero sembrado en TODOS los cierres: R14 se mide contra el, no contra el vacio. */
const MENSAJERO = "9f1c7a5e-0000-4000-8000-000000000abc";

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/* -------------------------------------------------------------------------- */
/* Fixture                                                                     */
/* -------------------------------------------------------------------------- */

function cierre(
  id: string,
  estado: string,
  solicitadoAt: Date,
  resueltoAt: Date | null,
  totales: { efectivo?: string; simpe?: string; transferencia?: string; general: string },
): FilaCierreDia {
  return {
    id,
    mensajeroId: MENSAJERO,
    estado,
    totalEfectivo: totales.efectivo ?? "0.00",
    totalSimpe: totales.simpe ?? "0.00",
    totalTransferencia: totales.transferencia ?? "0.00",
    totalGeneral: totales.general,
    solicitadoAt,
    resueltoAt,
  };
}

const CIERRES_DIA: readonly FilaCierreDia[] = [
  // Los dos aprobados del rango, fechados por `resuelto_at`. Juntos: 500 + 200 = 700.
  cierre("c1", "aprobado", ANTEAYER, DENTRO, { efectivo: "300.00", simpe: "100.00", transferencia: "100.00", general: "500.00" }),
  cierre("c2", "aprobado", AYER, DENTRO_TARDE, { efectivo: "200.00", general: "200.00" }),
  // Dinero EN EL AIRE: no aporta a ninguna cifra de dinero, pero se ve aqui (R25).
  cierre("c3", "solicitado", DENTRO, null, { efectivo: "900.00", general: "900.00" }),
  cierre("c4", "rechazado", DENTRO, DENTRO, { general: "50.00" }),
  cierre("c5", "vencido", DENTRO, null, { general: "70.00" }),
  // FUERA: aprobado resuelto AYER. Se solicito HOY, asi que fechar por `solicitado_at` lo metria.
  cierre("c6", "aprobado", DENTRO, AYER, { general: "6666.00" }),
  // FUERA: rechazado solicitado AYER. Se resolvio HOY, asi que fechar por `resuelto_at` lo metria.
  cierre("c7", "rechazado", AYER, DENTRO, { general: "7777.00" }),
  // FUERA: el corte `hasta` es EXCLUSIVO.
  cierre("c8", "aprobado", DENTRO, HASTA, { general: "8888.00" }),
];

const CIERRES_BODEGA: readonly FilaCierreBodega[] = [
  // Consolida c1 + c2: los MISMOS 700 colones, en el otro nivel. Fundir los niveles los contaria
  // dos veces (R22).
  cierre("b1", "aprobado", AYER, DENTRO, { efectivo: "500.00", simpe: "100.00", transferencia: "100.00", general: "700.00" }),
  cierre("b2", "solicitado", DENTRO, null, { general: "120.00" }),
];

/** El libro de tienda: el credito del COD de cada cierre y sus debitos. */
const LEDGER_TIENDA: readonly FilaLedgerTienda[] = [
  { tiendaId: "t-1", categoria: "cod_recaudado", tipo: "credito", monto: "500.00", fechaMovimiento: DENTRO, origenTipo: "cierre_dia", origenId: "c1" },
  { tiendaId: "t-1", categoria: "flete", tipo: "debito", monto: "60.00", fechaMovimiento: DENTRO, origenTipo: "cierre_dia", origenId: "c1" },
  { tiendaId: "t-2", categoria: "cod_recaudado", tipo: "credito", monto: "200.00", fechaMovimiento: DENTRO_TARDE, origenTipo: "cierre_dia", origenId: "c2" },
  // AJUSTE MANUAL dentro del rango: sin cierre de origen. Contarlo declararia un descuadre que no
  // existe — es exactamente la mutacion que R23 nombra.
  { tiendaId: "t-1", categoria: "ajuste_credito", tipo: "credito", monto: "999.00", fechaMovimiento: DENTRO, origenTipo: "manual", origenId: null },
  // Origen en un cierre que NO es de los aprobados del rango.
  { tiendaId: "t-3", categoria: "cod_recaudado", tipo: "credito", monto: "6666.00", fechaMovimiento: DENTRO, origenTipo: "cierre_dia", origenId: "c6" },
];

const CAJA: readonly FilaCaja[] = [
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "60.00", fechaMovimiento: DENTRO, origenTipo: "cierre_dia", origenId: "c1" },
  { categoria: "egreso_gasto", tipo: "egreso", monto: "11.00", fechaMovimiento: DENTRO, origenTipo: "manual", origenId: null },
];

const LEDGER_MENSAJERO: readonly FilaLedgerMensajero[] = [
  { mensajeroId: MENSAJERO, categoria: "pago_devengado", tipo: "devengo", monto: "40.00", fechaMovimiento: DENTRO, origenTipo: "cierre_dia", origenId: "c1" },
];

function repositorio(datos?: {
  cierresDia?: readonly FilaCierreDia[];
  cierresBodega?: readonly FilaCierreBodega[];
  ledgerTienda?: readonly FilaLedgerTienda[];
  caja?: readonly FilaCaja[];
  ledgerMensajero?: readonly FilaLedgerMensajero[];
}) {
  const fake = fakePrismaDinero({
    cierresDia: datos?.cierresDia ?? CIERRES_DIA,
    cierresBodega: datos?.cierresBodega ?? CIERRES_BODEGA,
    ledgerTienda: datos?.ledgerTienda ?? LEDGER_TIENDA,
    caja: datos?.caja ?? CAJA,
    ledgerMensajero: datos?.ledgerMensajero ?? LEDGER_MENSAJERO,
  });
  return { repo: new ConciliacionCierresAnaliticaRepository(fake.cliente), fake };
}

const CONSULTA = () => consultaDe("conciliacion_cierres");

/* -------------------------------------------------------------------------- */
/* R22 — los dos niveles, por separado                                         */
/* -------------------------------------------------------------------------- */

describe("R22 · conteo y totales snapshot por (nivel, estado), sin fundir los niveles", () => {
  it("el cierre_bodega que consolida dos cierre_dia NO duplica el dinero: sale en su propia fila", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());

    const dia = filas.filter((f) => f.nivel === "cierre_dia" && f.estado === "aprobado");
    const bodega = filas.filter((f) => f.nivel === "cierre_bodega" && f.estado === "aprobado");

    expect(dia).toHaveLength(1);
    expect(bodega).toHaveLength(1);
    // Los MISMOS 700, dos veces, pero cada uno etiquetado con su nivel. Si el repositorio los
    // fundiera, habria una sola fila de 1400 y el tablero mostraria el doble del dinero.
    expect(dia[0].totales.general).toBe("700.00");
    expect(bodega[0].totales.general).toBe("700.00");
    expect(dia[0].cantidad).toBe(2);
    expect(bodega[0].cantidad).toBe(1);
    expect(filas.every((f) => f.nivel === "cierre_dia" || f.nivel === "cierre_bodega")).toBe(true);
  });

  it("cada grupo trae su conteo y sus CUATRO totales snapshot", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());

    const aprobadosDia = filas.find((f) => f.nivel === "cierre_dia" && f.estado === "aprobado");
    expect(aprobadosDia?.totales).toEqual({
      efectivo: "500.00", // 300 (c1) + 200 (c2)
      simpe: "100.00",
      transferencia: "100.00",
      general: "700.00",
    });
    for (const fila of filas) {
      expect(Object.keys(fila.totales).sort()).toEqual([
        "efectivo",
        "general",
        "simpe",
        "transferencia",
      ]);
      expect(Number.isInteger(fila.cantidad)).toBe(true);
    }
  });

  it("los cuatro estados aparecen, cada uno con su conteo", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());

    const delDia = filas.filter((f) => f.nivel === "cierre_dia");
    expect(delDia.map((f) => [f.estado, f.cantidad])).toEqual([
      ["aprobado", 2],
      ["rechazado", 1],
      ["solicitado", 1],
      ["vencido", 1],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* R25 / R39 — la doble coordenada temporal, declarada por fila                */
/* -------------------------------------------------------------------------- */

describe("R25/R39 · cada fila declara con que fecha entro, y las dos fechas no se cruzan", () => {
  it("el cierre `solicitado` llega con fechadoPor: solicitado_at (no tiene resuelto_at que usar)", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());

    const solicitado = filas.find((f) => f.nivel === "cierre_dia" && f.estado === "solicitado");
    expect(solicitado?.fechadoPor).toBe("solicitado_at");
    expect(solicitado?.cantidad).toBe(1);
    // Y su dinero se VE, con 900 en efectivo, sin aportar a ninguna metrica de dinero (R25).
    expect(solicitado?.totales.general).toBe("900.00");
  });

  it("el `aprobado` llega con fechadoPor: resuelto_at, y los no resueltos nunca", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());

    for (const fila of filas) {
      expect(fila.fechadoPor, `${fila.nivel}/${fila.estado}`).toBe(
        fila.estado === "aprobado" ? "resuelto_at" : "solicitado_at",
      );
    }
  });

  it("un aprobado resuelto AYER no entra, aunque se solicitara hoy", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());
    // c6 (6666) se solicito dentro del rango: si los aprobados se fecharan por `solicitado_at`,
    // el total del grupo seria 7366 en vez de 700.
    const aprobados = filas.find((f) => f.nivel === "cierre_dia" && f.estado === "aprobado");
    expect(aprobados?.totales.general).toBe("700.00");
    expect(aprobados?.cantidad).toBe(2);
  });

  it("un rechazado solicitado AYER no entra, aunque se resolviera hoy", async () => {
    const { repo } = repositorio();
    const filas = await repo.contarCierresPorEstado(CONSULTA());
    // c7 (7777) se resolvio dentro del rango: si los no resueltos se fecharan por `resuelto_at`,
    // este grupo valdria 7827 en vez de 50.
    const rechazados = filas.find((f) => f.nivel === "cierre_dia" && f.estado === "rechazado");
    expect(rechazados?.totales.general).toBe("50.00");
    expect(rechazados?.cantidad).toBe(1);
  });

  it("y el corte por `hasta` es estricto: el cierre resuelto justo en el corte queda fuera", async () => {
    const { repo, fake } = repositorio();
    await repo.contarCierresPorEstado(CONSULTA());

    const where = fake.llamadas[0].args.where as Record<string, unknown>;
    const fecha = where.resueltoAt as Record<string, unknown>;
    expect(Object.keys(fecha).sort()).toEqual(["gte", "lt"]);
    expect(fecha.gte).toEqual(DESDE);
    expect(fecha.lt).toEqual(HASTA);
  });
});

/* -------------------------------------------------------------------------- */
/* R23 — el lado ledger se filtra POR ORIGEN, no por ventana                   */
/* -------------------------------------------------------------------------- */

describe("R23 · el ledger se cruza por origen_tipo/origen_id, nunca por el rango entero", () => {
  it("los aprobados del rango llegan con su total_general y su id, y nada mas", async () => {
    const { repo, fake } = repositorio();
    const snapshots = await repo.totalesDeCierresAprobados(CONSULTA());

    expect(snapshots).toEqual([
      { cierreId: "c1", totalGeneral: "500.00" },
      { cierreId: "c2", totalGeneral: "200.00" },
    ]);
    // R14: `select` explicito de DOS columnas. Sin el, el `findMany` traeria `mensajeroId`.
    const llamada = fake.llamadas.find((l) => l.operacion === "findMany");
    expect(Object.keys(llamada?.args.select as Record<string, unknown>).sort()).toEqual([
      "id",
      "totalGeneral",
    ]);
    expect(JSON.stringify(snapshots)).not.toContain(MENSAJERO);
  });

  it("un ajuste manual dentro del rango NO entra en el cruce", async () => {
    const { repo } = repositorio();
    const filas = await repo.sumarLedgerPorOrigenDeCierre(CONSULTA(), ["c1", "c2"]);

    // Los 999 del ajuste manual estan sembrados dentro del rango y no aparecen por ningun lado.
    expect(JSON.stringify(filas)).not.toContain("999.00");
    expect(filas).toEqual([
      { ledger: "wallet_movimiento", cierreId: "c1", tipo: "ingreso", suma: "60.00" },
      { ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "credito", suma: "500.00" },
      { ledger: "wallet_tienda_movimiento", cierreId: "c1", tipo: "debito", suma: "60.00" },
      { ledger: "wallet_tienda_movimiento", cierreId: "c2", tipo: "credito", suma: "200.00" },
      { ledger: "pago_mensajero_movimiento", cierreId: "c1", tipo: "devengo", suma: "40.00" },
    ]);
  });

  it("un movimiento con origen en un cierre AJENO al rango tampoco entra", async () => {
    const { repo } = repositorio();
    const filas = await repo.sumarLedgerPorOrigenDeCierre(CONSULTA(), ["c1", "c2"]);
    // Los 6666 tienen origen `c6`, que no esta en la lista.
    expect(JSON.stringify(filas)).not.toContain("6666.00");
  });

  it("el `where` del cruce nombra el origen y NO tiene ventana temporal", async () => {
    const { repo, fake } = repositorio();
    await repo.sumarLedgerPorOrigenDeCierre(CONSULTA(), ["c1", "c2"]);

    for (const llamada of fake.llamadas) {
      const where = llamada.args.where as Record<string, unknown>;
      expect(where.origenTipo).toBe("cierre_dia");
      expect(where.origenId).toEqual({ in: ["c1", "c2"] });
      // Filtrar TAMBIEN por fecha dejaria fuera el movimiento que un cierre aprobado hoy
      // registrase con fecha retroactiva, y el descuadre seria un artefacto del filtro.
      expect(where).not.toHaveProperty("fechaMovimiento");
    }
  });

  it("con la lista de cierres vacia no se consulta la base ni una vez", async () => {
    const { repo, fake } = repositorio();
    const filas = await repo.sumarLedgerPorOrigenDeCierre(CONSULTA(), []);

    expect(filas).toEqual([]);
    expect(fake.llamadas).toHaveLength(0);
  });

  it("el desglose llega por libro y por tipo, sin fundir los tres libros", async () => {
    const { repo } = repositorio();
    const filas = await repo.sumarLedgerPorOrigenDeCierre(CONSULTA(), ["c1", "c2"]);

    expect(new Set(filas.map((f) => f.ledger))).toEqual(
      new Set(["wallet_movimiento", "wallet_tienda_movimiento", "pago_mensajero_movimiento"]),
    );
    // El credito y el debito de `c1` en el libro de tienda llegan SEPARADOS: fundidos darian
    // 560, que no es comparable con ningun `total_*` del cierre.
    const deC1EnTienda = filas.filter(
      (f) => f.ledger === "wallet_tienda_movimiento" && f.cierreId === "c1",
    );
    expect(deC1EnTienda.map((f) => f.tipo)).toEqual(["credito", "debito"]);
  });
});

/* -------------------------------------------------------------------------- */
/* R14 — de un cierre sale su id, jamas su mensajero                           */
/* -------------------------------------------------------------------------- */

describe("R14 · ningun identificador de mensajero cruza este repositorio", () => {
  it("ni el conteo por estado ni el cruce de ledger llevan el uuid del mensajero", async () => {
    const { repo } = repositorio();
    const consulta = CONSULTA();
    const porEstado = await repo.contarCierresPorEstado(consulta);
    const cruce = await repo.sumarLedgerPorOrigenDeCierre(consulta, ["c1", "c2"]);

    expect(porEstado.length).toBeGreaterThan(0);
    expect(cruce.length).toBeGreaterThan(0);
    expect(JSON.stringify(porEstado)).not.toContain(MENSAJERO);
    expect(JSON.stringify(cruce)).not.toContain(MENSAJERO);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — orden estable y reproducible                                          */
/* -------------------------------------------------------------------------- */

describe("R28 · los tres metodos son reproducibles y piden orden explicito", () => {
  it("el conteo por estado sale siempre en el mismo orden (nivel, estado)", async () => {
    const { repo, fake } = repositorio();
    const consulta = CONSULTA();
    const a = await repo.contarCierresPorEstado(consulta);
    const b = await repo.contarCierresPorEstado(consulta);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(a.map((f) => `${f.nivel}/${f.estado}`)).toEqual([
      "cierre_dia/aprobado",
      "cierre_dia/rechazado",
      "cierre_dia/solicitado",
      "cierre_dia/vencido",
      "cierre_bodega/aprobado",
      "cierre_bodega/solicitado",
    ]);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ estado: "asc" }]);
  });

  it("el cruce de ledger sale ordenado por (ledger, cierre, tipo)", async () => {
    const { repo, fake } = repositorio();
    const consulta = CONSULTA();
    const a = await repo.sumarLedgerPorOrigenDeCierre(consulta, ["c1", "c2"]);
    const b = await repo.sumarLedgerPorOrigenDeCierre(consulta, ["c1", "c2"]);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ origenId: "asc" }, { tipo: "asc" }]);
  });

  it("los snapshots aprobados salen ordenados por id", async () => {
    const { repo, fake } = repositorio();
    const consulta = CONSULTA();
    const a = await repo.totalesDeCierresAprobados(consulta);
    const b = await repo.totalesDeCierresAprobados(consulta);

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual({ id: "asc" });
  });
});

/* -------------------------------------------------------------------------- */
/* Ni un caso pasa por conjunto vacio                                          */
/* -------------------------------------------------------------------------- */

describe("los tests de arriba no pasan por conjunto vacio", () => {
  it("el fixture siembra los cuatro estados, los dos niveles y las filas que deben quedar FUERA", () => {
    expect(new Set(CIERRES_DIA.map((c) => c.estado))).toEqual(
      new Set(["aprobado", "solicitado", "rechazado", "vencido"]),
    );
    expect(CIERRES_BODEGA.length).toBeGreaterThan(1);
    // Las tres exclusiones que los casos de arriba miden, sembradas de verdad.
    expect(CIERRES_DIA.some((c) => c.estado === "aprobado" && c.resueltoAt?.getTime() === AYER.getTime())).toBe(true);
    expect(CIERRES_DIA.some((c) => c.estado === "rechazado" && c.solicitadoAt.getTime() === AYER.getTime())).toBe(true);
    expect(CIERRES_DIA.some((c) => c.resueltoAt?.getTime() === HASTA.getTime())).toBe(true);
    // Y el ajuste manual y el movimiento de origen ajeno.
    expect(LEDGER_TIENDA.some((m) => m.origenId === null && m.fechaMovimiento >= DESDE && m.fechaMovimiento < HASTA)).toBe(true);
    expect(LEDGER_TIENDA.some((m) => m.origenId === "c6")).toBe(true);
    // Todos los cierres llevan mensajeroId: R14 se mide contra un valor real.
    expect(CIERRES_DIA.every((c) => c.mensajeroId === MENSAJERO)).toBe(true);
  });

  it("y los tres metodos devuelven filas con importe distinto de cero", async () => {
    const { repo } = repositorio();
    const consulta = CONSULTA();
    const porEstado = await repo.contarCierresPorEstado(consulta);
    const snapshots = await repo.totalesDeCierresAprobados(consulta);
    const cruce = await repo.sumarLedgerPorOrigenDeCierre(consulta, ["c1", "c2"]);

    expect(porEstado).toHaveLength(6);
    expect(snapshots).toHaveLength(2);
    expect(cruce).toHaveLength(5);
    expect(porEstado.every((f) => f.totales.general !== "0.00")).toBe(true);
    expect(snapshots.every((s) => s.totalGeneral !== "0.00")).toBe(true);
    expect(cruce.every((f) => f.suma !== "0.00")).toBe(true);
  });
});
