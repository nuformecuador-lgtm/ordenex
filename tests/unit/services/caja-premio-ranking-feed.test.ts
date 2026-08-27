import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CajaPremioRankingFeedService } from "@/lib/services/CajaPremioRankingFeedService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { CajaPremioRankingTxClient } from "@/lib/interfaces/services/ICajaPremioRankingFeedService";

// Feature 293 (T4.1, design §7.1, R20/R29) — EL PUERTO ESTRECHO de la caja para el premio.
//
// Dos cosas se afirman aqui:
//   1. las DOS filas exactas que escribe (tipo, categoria, origen y monto), campo a campo;
//   2. que el puerto NO PUEDE expresar otra escritura: `tipo`, `categoria` y `origenTipo` son
//      literales de ESTE archivo y no salen de ningun parametro. Lo segundo se mide sobre la
//      FIRMA y sobre el fuente, no leyendo el comentario.

const MOVIMIENTO = {
  filaId: "fila-podio-1",
  monto: "5000.00",
  descripcion: "Premio del ranking 2026-08-26 · posición 1 · Bono por buen rendimiento",
  registradoPor: "u-maestro",
};

function dobles() {
  const crearMovimientos = vi.fn(
    async (_tx: unknown, _movs: CrearMovimientoInput[]) => 1,
  );
  const cajaRepo = { crearMovimientos } as unknown as IWalletMovimientoRepository;
  const tx = { walletMovimiento: {} } as unknown as CajaPremioRankingTxClient;
  return { servicio: new CajaPremioRankingFeedService(cajaRepo), crearMovimientos, tx };
}

type EspiaCaja = ReturnType<typeof dobles>["crearMovimientos"];

function movimientosDe(espia: EspiaCaja, llamada: number): CrearMovimientoInput[] {
  const call = espia.mock.calls[llamada];
  expect(call, `no hubo llamada ${llamada}`).toBeDefined();
  return call![1];
}

function filaEscrita(espia: EspiaCaja): CrearMovimientoInput {
  const movs = movimientosDe(espia, 0);
  expect(movs).toHaveLength(1);
  return movs[0]!;
}

describe("R20 — el egreso del premio sale de la caja con la clave de la FILA DEL PODIO", () => {
  it("escribe EXACTAMENTE una fila `egreso` / `egreso_pago_mensajero`", async () => {
    const { servicio, crearMovimientos, tx } = dobles();

    const n = await servicio.emitirEgresoPremio(tx, MOVIMIENTO);

    expect(n).toBe(1);
    expect(filaEscrita(crearMovimientos)).toEqual({
      tipo: "egreso",
      categoria: "egreso_pago_mensajero",
      monto: "5000.00",
      // R20 / design §3.4: el origen es la FILA DEL PODIO, no el cierre. Con
      // `(cierre_dia, cierreId)` esta fila caeria en `ON CONFLICT DO NOTHING` contra el
      // `egreso_pago_mensajero` que el feed del cierre ya escribio al aprobar: dinero fuera de
      // la caja sin registro y sin error.
      origenTipo: "ranking_snapshot_fila",
      origenId: "fila-podio-1",
      descripcion: MOVIMIENTO.descripcion,
      registradoPor: "u-maestro",
    });
  });

  it("R23: NO se pasa `fechaMovimiento` — la caja se fecha en el INSTANTE del registro", async () => {
    // Fechar el egreso en el dia del podio reescribiria el dinero de un dia ya leido, porque
    // `lib/utils/finanzas-diarias.ts` agrega la caja POR DIA.
    const { servicio, crearMovimientos, tx } = dobles();

    await servicio.emitirEgresoPremio(tx, MOVIMIENTO);

    expect(filaEscrita(crearMovimientos)).not.toHaveProperty("fechaMovimiento");
  });

  it("escribe en la `tx` que se le da, no en un cliente propio", async () => {
    const { servicio, crearMovimientos, tx } = dobles();

    await servicio.emitirEgresoPremio(tx, MOVIMIENTO);

    expect(crearMovimientos.mock.calls[0]![0]).toBe(tx);
  });

  it("devolver 0 es el desenlace CORRECTO del reintento, no un fallo", async () => {
    const crearMovimientos = vi.fn(async (_tx: unknown, _movs: CrearMovimientoInput[]) => 0); // DO NOTHING
    const servicio = new CajaPremioRankingFeedService({
      crearMovimientos,
    } as unknown as IWalletMovimientoRepository);

    await expect(
      servicio.emitirEgresoPremio({} as CajaPremioRankingTxClient, MOVIMIENTO),
    ).resolves.toBe(0);
  });
});

describe("R29 — el reverso devuelve el dinero con la MISMA clave y otra categoria", () => {
  it("escribe `ingreso` / `ingreso_ajuste` sobre el MISMO `(origen_tipo, origen_id)`", async () => {
    const { servicio, crearMovimientos, tx } = dobles();

    await servicio.reversarEgresoPremio(tx, MOVIMIENTO);

    expect(filaEscrita(crearMovimientos)).toEqual({
      tipo: "ingreso",
      // `ingreso_ajuste` y NO un `ingreso_reverso_*` nuevo: a diferencia de la 173, el egreso
      // original ya era de naturaleza PROPIA, asi que revertirlo aqui no infla la ganancia.
      categoria: "ingreso_ajuste",
      monto: "5000.00",
      origenTipo: "ranking_snapshot_fila",
      origenId: "fila-podio-1",
      descripcion: MOVIMIENTO.descripcion,
      registradoPor: "u-maestro",
    });
  });

  it("egreso y reverso comparten `(origen_tipo, origen_id)` y solo cambian de categoria", async () => {
    // Es lo que deja convivir a las dos filas bajo el unico parcial
    // `(origen_tipo, origen_id, categoria)` de la caja, sin que ninguna pueda duplicarse.
    const { servicio, crearMovimientos, tx } = dobles();

    await servicio.emitirEgresoPremio(tx, MOVIMIENTO);
    await servicio.reversarEgresoPremio(tx, MOVIMIENTO);

    const egreso = movimientosDe(crearMovimientos, 0)[0]!;
    const reverso = movimientosDe(crearMovimientos, 1)[0]!;
    expect(egreso.origenTipo).toBe(reverso.origenTipo);
    expect(egreso.origenId).toBe(reverso.origenId);
    expect(egreso.categoria).not.toBe(reverso.categoria);
  });

  it("R29: el monto del reverso es EL MISMO del egreso, sin aritmetica de por medio", async () => {
    const { servicio, crearMovimientos, tx } = dobles();

    await servicio.reversarEgresoPremio(tx, { ...MOVIMIENTO, monto: "0.01" });

    expect(filaEscrita(crearMovimientos).monto).toBe("0.01");
  });
});

describe("R20/R29 — el puerto no PUEDE expresar otra escritura en la caja", () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "services", "CajaPremioRankingFeedService.ts"),
    "utf8",
  );
  const contrato = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "lib",
      "interfaces",
      "services",
      "ICajaPremioRankingFeedService.ts",
    ),
    "utf8",
  );

  it("el tipo de entrada NO tiene campo `tipo`, ni `categoria`, ni `origenTipo`", () => {
    const bloque = contrato.slice(
      contrato.indexOf("export interface MovimientoDeCajaDePremio"),
      contrato.indexOf("export interface ICajaPremioRankingFeedService"),
    );
    expect(bloque).toContain("filaId");
    expect(bloque).not.toMatch(/^\s*tipo:/m);
    expect(bloque).not.toMatch(/^\s*categoria:/m);
    expect(bloque).not.toMatch(/^\s*origenTipo:/m);
  });

  it("las tres decisiones son LITERALES en la implementacion, una vez cada una", () => {
    const veces = (re: RegExp) => (fuente.match(re) ?? []).length;
    expect(veces(/categoria: "egreso_pago_mensajero"/g)).toBe(1);
    expect(veces(/categoria: "ingreso_ajuste"/g)).toBe(1);
    expect(veces(/origenTipo: "ranking_snapshot_fila"/g)).toBe(2); // una por metodo
    // Y no salen de ningun parametro: no hay interpolacion ni acceso al movimiento.
    expect(fuente).not.toMatch(/categoria: movimiento\./);
    expect(fuente).not.toMatch(/tipo: movimiento\./);
  });

  it("money-safe: la implementacion no hace aritmetica con el monto", () => {
    expect(fuente).not.toMatch(/parseFloat/);
    expect(fuente).not.toMatch(/Number\(/);
    expect(fuente).not.toMatch(/monto\s*[+\-*/]/);
  });
});
