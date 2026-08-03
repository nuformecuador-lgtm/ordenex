import { describe, it, expect } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { RecaudoAnaliticaRepository } from "@/lib/repositories/RecaudoAnaliticaRepository";
import {
  fakePrismaDinero,
  type FilaCierreDia,
  type FilaLedgerTienda,
} from "./_fake-prisma-dinero";

// Feature 127 / T C.2 — `RecaudoAnaliticaRepository`: R19, R25, R26, R28.
//
// Los dos "hecho cuando" de la tarea, otra vez escritos como mutaciones:
//   1. el mensajero con ordenes de DOS tiendas: las dos vistas no se suman en el repositorio;
//   2. el cierre `solicitado` no aporta importe.
//
// El caso 1 no se puede comprobar solo con numeros: si las dos vistas valen 1000 cada una,
// tambien vale 1000 la mitad de una suma mal hecha. Por eso se juzga por TRES vias a la vez —el
// valor, la tabla que cada metodo toca (el fake registra las llamadas) y la superficie publica
// de la clase—, que es lo que hace que fundir los dos metodos en uno se ponga rojo.
//
// El caso 2 se prueba en DOS fases (sin aprobar / aprobado) para que no pueda pasar por ausencia
// de datos: el mismo cierre, aprobado, SI aporta.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-08-02T15:00:00.000Z");
const DESDE = new Date("2026-08-02T06:00:00.000Z");
const HASTA = new Date("2026-08-03T06:00:00.000Z");
const DENTRO = new Date("2026-08-02T14:00:00.000Z");
const ANTES = new Date("2026-08-01T14:00:00.000Z");

function consultaCodRecaudado(): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "cod_recaudado", AHORA);
  if (r.status !== "ok") throw new Error("no se pudo preparar la consulta de cod_recaudado");
  return r.consulta;
}

function cierre(p: Partial<FilaCierreDia> & { id: string; estado: string }): FilaCierreDia {
  return {
    totalEfectivo: "0.00",
    totalSimpe: "0.00",
    totalTransferencia: "0.00",
    totalGeneral: "0.00",
    solicitadoAt: DENTRO,
    resueltoAt: null,
    ...p,
  };
}

/* -------------------------------------------------------------------------- */
/* Los cierres del dia                                                         */
/* -------------------------------------------------------------------------- */

const CIERRES: readonly FilaCierreDia[] = [
  cierre({ id: "c1", estado: "aprobado", resueltoAt: DENTRO, totalEfectivo: "600.00", totalSimpe: "300.00", totalTransferencia: "100.00", totalGeneral: "1000.00" }),
  cierre({ id: "c2", estado: "aprobado", resueltoAt: DENTRO, totalEfectivo: "200.00", totalSimpe: "50.00", totalGeneral: "250.00" }),
  // No resueltos: NO aportan importe (R25).
  cierre({ id: "c3", estado: "solicitado", totalEfectivo: "500.00", totalGeneral: "500.00" }),
  cierre({ id: "c4", estado: "rechazado", resueltoAt: DENTRO, totalEfectivo: "400.00", totalGeneral: "400.00" }),
  cierre({ id: "c5", estado: "vencido", totalEfectivo: "111.00", totalGeneral: "111.00" }),
  // Aprobado, pero resuelto ANTES del rango.
  cierre({ id: "c6", estado: "aprobado", resueltoAt: ANTES, solicitadoAt: ANTES, totalEfectivo: "900.00", totalGeneral: "900.00" }),
  // Aprobado en el borde SUPERIOR (exclusivo): fuera.
  cierre({ id: "c7", estado: "aprobado", resueltoAt: HASTA, totalEfectivo: "888.00", totalGeneral: "888.00" }),
];

/* -------------------------------------------------------------------------- */
/* El ledger de tienda                                                         */
/* -------------------------------------------------------------------------- */

const LEDGER: readonly FilaLedgerTienda[] = [
  { tiendaId: "tienda-a", categoria: "cod_recaudado", tipo: "credito", monto: "600.00", fechaMovimiento: DENTRO },
  { tiendaId: "tienda-b", categoria: "cod_recaudado", tipo: "credito", monto: "400.00", fechaMovimiento: DENTRO },
  // Categorias del ledger que `cod_recaudado` NO declara: fuera de esta vista.
  { tiendaId: "tienda-a", categoria: "flete", tipo: "debito", monto: "50.00", fechaMovimiento: DENTRO },
  { tiendaId: "tienda-b", categoria: "ajuste_debito", tipo: "debito", monto: "30.00", fechaMovimiento: DENTRO },
  // Fuera de la ventana.
  { tiendaId: "tienda-a", categoria: "cod_recaudado", tipo: "credito", monto: "700.00", fechaMovimiento: ANTES },
];

function repositorio(
  cierresDia: readonly FilaCierreDia[] = CIERRES,
  ledgerTienda: readonly FilaLedgerTienda[] = LEDGER,
) {
  const fake = fakePrismaDinero({ cierresDia, ledgerTienda });
  return { repo: new RecaudoAnaliticaRepository(fake.cliente), fake };
}

/* -------------------------------------------------------------------------- */
/* R19 — dos vistas, y NO se suman aqui                                        */
/* -------------------------------------------------------------------------- */

describe("R19 · las dos vistas de cod_recaudado viven separadas en el repositorio", () => {
  it("el mensajero con ordenes de dos tiendas: cada vista vale 1000, la suma de las dos NO es la cifra", async () => {
    // UN cierre aprobado de 1000 (lo que el mensajero entrego) y el MISMO dinero acreditado a
    // dos tiendas (600 + 400). El dinero real son 1000. Un repositorio que fundiera las dos
    // vistas serviria 2000.
    const { repo } = repositorio(
      [cierre({ id: "unico", estado: "aprobado", resueltoAt: DENTRO, totalEfectivo: "1000.00", totalGeneral: "1000.00" })],
      [
        { tiendaId: "tienda-a", categoria: "cod_recaudado", tipo: "credito", monto: "600.00", fechaMovimiento: DENTRO },
        { tiendaId: "tienda-b", categoria: "cod_recaudado", tipo: "credito", monto: "400.00", fechaMovimiento: DENTRO },
      ],
    );
    const consulta = consultaCodRecaudado();

    const porMetodo = await repo.porMetodoDeCierresResueltos(consulta);
    const porTienda = await repo.porTiendaDeLedger(consulta);

    expect(porMetodo).toEqual([
      { metodo: "efectivo", suma: "1000.00" },
      { metodo: "simpe", suma: "0.00" },
      { metodo: "transferencia", suma: "0.00" },
    ]);
    expect(porTienda).toEqual([
      { tiendaId: "tienda-a", tipo: "credito", suma: "600.00" },
      { tiendaId: "tienda-b", tipo: "credito", suma: "400.00" },
    ]);

    const sumar = (xs: readonly { suma: string }[]) =>
      xs.reduce((acc, x) => acc + Number(x.suma), 0);
    expect(sumar(porMetodo)).toBe(1000);
    expect(sumar(porTienda)).toBe(1000);
    // Y ningun metodo devuelve el doble: el 2000 no existe en ninguna salida.
    expect([...porMetodo, ...porTienda].map((x) => x.suma)).not.toContain("2000.00");
  });

  it("cada metodo consulta SU tabla y solo la suya", async () => {
    const consulta = consultaCodRecaudado();

    const a = repositorio();
    await a.repo.porMetodoDeCierresResueltos(consulta);
    expect(a.fake.llamadas.map((l) => l.modelo)).toEqual(["cierreDia"]);

    const b = repositorio();
    await b.repo.porTiendaDeLedger(consulta);
    expect(b.fake.llamadas.map((l) => l.modelo)).toEqual(["walletTiendaMovimiento"]);
  });

  it("la clase no ofrece un tercer metodo que funda las dos vistas", () => {
    const metodos = Object.getOwnPropertyNames(RecaudoAnaliticaRepository.prototype).sort();
    expect(metodos).toEqual(["constructor", "porMetodoDeCierresResueltos", "porTiendaDeLedger"]);
  });

  it("la vista por tienda toma la categoria del catalogo y deja fuera el resto del ledger", async () => {
    const { repo } = repositorio();
    const filas = await repo.porTiendaDeLedger(consultaCodRecaudado());

    expect(filas).toEqual([
      { tiendaId: "tienda-a", tipo: "credito", suma: "600.00" },
      { tiendaId: "tienda-b", tipo: "credito", suma: "400.00" },
    ]);
    // `flete` y `ajuste_debito` estan sembrados en el mismo dia y no aparecen.
    expect(filas.map((f) => f.suma)).not.toContain("50.00");
    expect(filas.map((f) => f.suma)).not.toContain("30.00");
    // Y el de ayer tampoco: 600, no 1300.
    expect(filas[0].suma).toBe("600.00");
  });
});

/* -------------------------------------------------------------------------- */
/* R25 — el cierre no resuelto no aporta dinero                                */
/* -------------------------------------------------------------------------- */

describe("R25 · solo los cierres APROBADOS del rango aportan importe", () => {
  it("un cierre `solicitado` con 500 en efectivo no suma nada", async () => {
    const { repo, fake } = repositorio();
    const porMetodo = await repo.porMetodoDeCierresResueltos(consultaCodRecaudado());

    // 600 (c1) + 200 (c2). Ni el solicitado (500), ni el rechazado (400), ni el vencido (111),
    // ni el aprobado de ayer (900), ni el del borde superior (888).
    expect(porMetodo).toEqual([
      { metodo: "efectivo", suma: "800.00" },
      { metodo: "simpe", suma: "350.00" },
      { metodo: "transferencia", suma: "100.00" },
    ]);
    const where = fake.llamadas[0].args.where as Record<string, unknown>;
    expect(where.estado).toBe("aprobado");
  });

  it("un `rechazado` RESUELTO dentro del rango tampoco: aqui la exclusion la hace el estado", async () => {
    // Este caso es el que de verdad mide el filtro por estado. Un cierre `solicitado` no tiene
    // `resuelto_at` y quedaria fuera igual por la coordenada temporal; un `rechazado` (o un
    // `vencido`) SI puede estar resuelto dentro de la ventana, y solo el `estado: "aprobado"`
    // impide que su dinero —que nunca existio— entre en la cifra.
    const { repo } = repositorio(
      [cierre({ id: "r", estado: "rechazado", resueltoAt: DENTRO, totalEfectivo: "400.00" })],
      [],
    );
    expect((await repo.porMetodoDeCierresResueltos(consultaCodRecaudado()))[0].suma).toBe("0.00");
  });

  it("y el MISMO cierre, una vez aprobado, si aporta: no pasa por ausencia de datos", async () => {
    const soloPendiente = [cierre({ id: "p", estado: "solicitado", totalEfectivo: "500.00" })];
    const yaAprobado = [
      cierre({ id: "p", estado: "aprobado", resueltoAt: DENTRO, totalEfectivo: "500.00" }),
    ];

    const antes = await repositorio(soloPendiente, []).repo.porMetodoDeCierresResueltos(
      consultaCodRecaudado(),
    );
    const despues = await repositorio(yaAprobado, []).repo.porMetodoDeCierresResueltos(
      consultaCodRecaudado(),
    );

    // Ojo con lo que este caso prueba y lo que no: el pendiente queda fuera por DOS motivos
    // independientes (no es `aprobado` y no tiene `resuelto_at`). Lo que aporta es la fase 2:
    // el mismo cierre, con los mismos totales, si cuenta en cuanto se resuelve, asi que el
    // "0.00" de arriba no es "no habia datos".
    expect(antes[0]).toEqual({ metodo: "efectivo", suma: "0.00" });
    expect(despues[0]).toEqual({ metodo: "efectivo", suma: "500.00" });
  });

  it("el cierre se fecha por `resuelto_at`, no por `solicitado_at` (R26, ⟨D2b⟩)", async () => {
    // Solicitado el lunes anterior, aprobado HOY: cuenta hoy.
    const lunes = new Date("2026-07-27T14:00:00.000Z");
    const { repo, fake } = repositorio(
      [cierre({ id: "tardio", estado: "aprobado", solicitadoAt: lunes, resueltoAt: DENTRO, totalEfectivo: "321.00" })],
      [],
    );

    expect((await repo.porMetodoDeCierresResueltos(consultaCodRecaudado()))[0].suma).toBe("321.00");
    const where = fake.llamadas[0].args.where as Record<string, Record<string, Date>>;
    expect(where.resueltoAt.gte).toEqual(DESDE);
    expect(where.resueltoAt.lt).toEqual(HASTA);
    expect(where).not.toHaveProperty("solicitadoAt");
  });

  it("sin ningun cierre aprobado en el rango, los tres metodos son 0.00 y siguen siendo tres", async () => {
    const { repo } = repositorio([cierre({ id: "solo", estado: "solicitado", totalEfectivo: "9.00" })], []);
    expect(await repo.porMetodoDeCierresResueltos(consultaCodRecaudado())).toEqual([
      { metodo: "efectivo", suma: "0.00" },
      { metodo: "simpe", suma: "0.00" },
      { metodo: "transferencia", suma: "0.00" },
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — orden estable en la vista por tienda                                  */
/* -------------------------------------------------------------------------- */

describe("R28 · la vista por tienda llega ordenada y reproducible", () => {
  it("pide orden explicito por (tienda_id, tipo) y dos corridas dan lo mismo", async () => {
    const { repo, fake } = repositorio();
    const a = await repo.porTiendaDeLedger(consultaCodRecaudado());
    const b = await repo.porTiendaDeLedger(consultaCodRecaudado());

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ tiendaId: "asc" }, { tipo: "asc" }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Ni un caso pasa por conjunto vacio                                          */
/* -------------------------------------------------------------------------- */

describe("los tests de arriba no pasan por conjunto vacio", () => {
  it("hay cierres de los cuatro estados y ledger sembrado, incluido lo que debe quedar fuera", () => {
    expect(new Set(CIERRES.map((c) => c.estado))).toEqual(
      new Set(["aprobado", "solicitado", "rechazado", "vencido"]),
    );
    expect(CIERRES.filter((c) => c.estado === "aprobado").length).toBeGreaterThanOrEqual(3);
    expect(LEDGER.length).toBeGreaterThanOrEqual(5);
    expect(LEDGER.some((f) => f.categoria !== "cod_recaudado")).toBe(true);
    expect(LEDGER.some((f) => f.fechaMovimiento < DESDE)).toBe(true);
  });

  it("y las dos vistas devuelven filas con importe distinto de cero", async () => {
    const { repo } = repositorio();
    const consulta = consultaCodRecaudado();
    const porMetodo = await repo.porMetodoDeCierresResueltos(consulta);
    const porTienda = await repo.porTiendaDeLedger(consulta);

    expect(porMetodo.filter((f) => f.suma !== "0.00").length).toBe(3);
    expect(porTienda.length).toBe(2);
  });
});
