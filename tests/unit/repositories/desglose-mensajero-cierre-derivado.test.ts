import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type { ListarPorMensajeroFiltros } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 205 / T2.4 (R43, design §7.3) — el CIERRE de cada fila del desglose, DERIVADO.
//
// Por que vive aqui y no en el servicio: los tests de servicio usan un DOBLE del repositorio, asi
// que no ven ni la consulta que resuelve el pago ni cuantas veces se hace. La derivacion tiene
// dos propiedades que solo se pueden medir en este archivo:
//
//  1. las TRES ramas de §7.3 (`cierre_dia` -> el origen ES el cierre; `pago_mensajero` -> el
//     cierre del documento; el resto -> `null`), y
//  2. que la resolucion cueste UNA consulta por PAGINA y no una por fila. Es la diferencia entre
//     un desglose que abre 20 conexiones y uno que abre una — el mismo patron de dos pasos que la
//     172 ya usa en `buildFiltrosWhere`.
//
// Money-safe: ni un `Number(` ni un `parseFloat` sobre un monto en todo el archivo.

const FILTROS: ListarPorMensajeroFiltros = { mensajeroId: "m1", page: 1, pageSize: 20 };

/** Una fila del libro tal como la devuelve Prisma (monto `Decimal`, fecha `Date`). */
function movRow(over: Record<string, unknown> = {}) {
  return {
    id: "mov-1",
    mensajeroId: "m1",
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: new Prisma.Decimal("1000.00"),
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
    createdAt: new Date("2026-07-12T10:00:00.000Z"),
    ...over,
  };
}

/** La forma EXACTA de la consulta que resuelve el cierre de los pagos de una pagina. */
interface ArgsPagos {
  where: { id: { in: string[] } };
  select: { id: true; cierreId: true };
}

function prismaFalso(filas: unknown[], pagos: Array<{ id: string; cierreId: string | null }>) {
  const movFindMany = vi.fn(async () => filas);
  const count = vi.fn(async () => filas.length);
  const pagoFindMany = vi.fn(async (_args: ArgsPagos) => pagos);
  const cliente = {
    pagoMensajeroMovimiento: { findMany: movFindMany, count },
    liquidacionPago: { findMany: pagoFindMany },
    usuario: { findMany: vi.fn(), findUnique: vi.fn() },
  };
  return {
    repo: new PagoMensajeroMovimientoRepository(cliente as unknown as PrismaClient),
    movFindMany,
    pagoFindMany,
  };
}

describe("205 / R43 — el cierre de cada fila del desglose se DERIVA", () => {
  it("`cierre_dia`: el `origen_id` ES el cierre, y no se consulta nada", async () => {
    const { repo, pagoFindMany } = prismaFalso([movRow()], []);

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    expect(movimientos[0].cierreId).toBe("c1");
    expect(movimientos[0].origenId).toBe("c1");
    // Una pagina sin pagos NO paga una consulta por nada.
    expect(pagoFindMany).not.toHaveBeenCalled();
  });

  it("`pago_mensajero`: el cierre sale del DOCUMENTO, resuelto por consulta", async () => {
    const { repo, pagoFindMany } = prismaFalso(
      [movRow({ id: "mov-2", origenTipo: "pago_mensajero", origenId: "pago-9" })],
      [{ id: "pago-9", cierreId: "c7" }],
    );

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    // El `origen_id` es el PAGO y el cierre es OTRO id: si la derivacion copiara el origen —el
    // error natural— la fila enlazaria a un cierre que no existe.
    expect(movimientos[0].origenId).toBe("pago-9");
    expect(movimientos[0].cierreId).toBe("c7");
    expect(pagoFindMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: ["pago-9"] } },
      select: { id: true, cierreId: true },
    });
  });

  it("`manual` (y cualquier otro origen) no identifica ningun cierre: `null`", async () => {
    // R43: la fila que no identifica cierre NO lleva enlace. Inventarle uno seria peor que no
    // ofrecerlo. El `manual` es ademas el unico origen con `origen_id` NULL (schema.prisma).
    const { repo } = prismaFalso(
      [
        movRow({ id: "mov-3", origenTipo: "manual", origenId: null, categoria: "ajuste_devengo" }),
        movRow({ id: "mov-4", origenTipo: "otro_origen_futuro", origenId: "x1" }),
      ],
      [],
    );

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    expect(movimientos.map((m) => m.cierreId)).toEqual([null, null]);
  });

  it("un pago que no aparece en el mapa no inventa cierre (ni revienta)", async () => {
    // Imposible por la FK, pero el tipo lo admite: `cierreId` es nullable en `liquidacion_pago`
    // (un pago a TIENDA no lleva cierre). Las dos formas de «no hay cierre» caen en `null`.
    const { repo } = prismaFalso(
      [
        movRow({ id: "mov-5", origenTipo: "pago_mensajero", origenId: "pago-sin-cierre" }),
        movRow({ id: "mov-6", origenTipo: "pago_mensajero", origenId: "pago-ausente" }),
      ],
      [{ id: "pago-sin-cierre", cierreId: null }],
    );

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    expect(movimientos.map((m) => m.cierreId)).toEqual([null, null]);
  });

  it("UNA consulta por PAGINA, no una por fila — aunque la pagina traiga 20 pagos", async () => {
    const filas = Array.from({ length: 20 }, (_, i) =>
      movRow({ id: `mov-${i}`, origenTipo: "pago_mensajero", origenId: `pago-${i}` }),
    );
    const pagos = Array.from({ length: 20 }, (_, i) => ({ id: `pago-${i}`, cierreId: `c-${i}` }));
    const { repo, pagoFindMany } = prismaFalso(filas, pagos);

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    expect(pagoFindMany).toHaveBeenCalledTimes(1);
    expect(pagoFindMany.mock.calls[0]![0].where.id.in).toHaveLength(20);
    expect(movimientos.map((m) => m.cierreId)).toEqual(pagos.map((p) => p.cierreId));
  });

  it("los ids de pago van SIN repetir: un pago y su contraasiento comparten `origen_id`", async () => {
    // §6.2 de la 172: la anulacion escribe su contraasiento con el MISMO `origen_id` que su
    // pago. Sin deduplicar, la consulta llevaria el id dos veces por cada anulacion.
    const { repo, pagoFindMany } = prismaFalso(
      [
        movRow({ id: "mov-7", origenTipo: "pago_mensajero", origenId: "pago-9" }),
        movRow({
          id: "mov-8",
          origenTipo: "pago_mensajero",
          origenId: "pago-9",
          categoria: "ajuste_devengo",
        }),
      ],
      [{ id: "pago-9", cierreId: "c7" }],
    );

    const { movimientos } = await repo.listarPorMensajero(FILTROS);

    expect(pagoFindMany.mock.calls[0]![0].where.id.in).toEqual(["pago-9"]);
    // Y las dos filas enlazan al MISMO cierre: el pago y su reverso viven en el mismo sitio.
    expect(movimientos.map((m) => m.cierreId)).toEqual(["c7", "c7"]);
  });

  it("R43/§7.3: CERO cambios de esquema — el libro NO gana ninguna columna de cierre", async () => {
    // La alternativa descartada (§11.G de la 172) era anadir `cierre_id` a este libro: exigiria
    // backfillear una tabla declarada INMUTABLE y crearia una segunda forma de decir de donde
    // viene un movimiento. Que el cierre sea derivado es la decision, y aqui queda fijada.
    const schema = fs.readFileSync(path.join(process.cwd(), "db/schema.prisma"), "utf8");
    const modelo = quitarComentarios(
      /model PagoMensajeroMovimiento \{[\s\S]*?\n\}/.exec(schema)![0],
    );

    expect(modelo).not.toMatch(/cierreId/);
    expect(modelo).not.toMatch(/cierre_id/);
  });

  it("la DESCARGA del desglose no gana el campo: el archivo sigue sin emitir identificadores", async () => {
    // T2.4 lo exige explicitamente. Se mide sobre las columnas declaradas, no sobre una fila
    // proyectada: asi tambien cae si alguien anade la columna y la deja vacia.
    const columnas = await import(
      "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas"
    );
    const claves = columnas.COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO.map(
      (c: { clave: string }) => c.clave,
    );
    expect(claves).not.toContain("cierreId");
    for (const clave of claves) expect(clave, clave).not.toMatch(/(?<![a-z])Id$|_id$|^id$/);
  });
});
