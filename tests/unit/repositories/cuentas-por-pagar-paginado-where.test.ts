import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type { RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 170 — FASE 2, T L.1 (R40/R41/R45/R49/R51/R54) — las CONSULTAS del listado paginado de
// «Cuentas por pagar a mensajeros».
//
// Este archivo existe por un aviso ya MEDIDO tres veces (tandas I, J y K): los tests de servicio
// usan un DOBLE del repositorio, asi que no ven la traduccion a consultas. En la tanda I una
// mutacion del `WHERE` paso verde; en la J, dos mas; en la K, tres. Hermano de
// `historicos-paginados-where.test.ts`, `colas-paginadas-where.test.ts` y
// `satelite-paginado-where.test.ts`.
//
// Lo que aqui se vigila es lo que este listado tiene de particular, y es DINERO: cada fila es la
// suma de TODO el libro de ese mensajero. Si la agregacion llegara a llevar `where`, `take` o
// `skip` —«optimizar la pagina»— la columna «cuenta por pagar» empezaria a declarar una deuda
// mas pequena que la real, sin un solo error y sin que el total lo delatara.

const RANGO: RangoPagina = { skip: 2, take: 2 };

/** Grupos tal como los devuelve `groupBy(["mensajeroId","tipo"])`, con Decimal de verdad. */
const GRUPOS = [
  { mensajeroId: "m-c", tipo: "devengo", _sum: { monto: new Prisma.Decimal("900.00") } },
  { mensajeroId: "m-c", tipo: "pago", _sum: { monto: new Prisma.Decimal("900.00") } },
  { mensajeroId: "m-a", tipo: "devengo", _sum: { monto: new Prisma.Decimal("1000.00") } },
  { mensajeroId: "m-a", tipo: "pago", _sum: { monto: new Prisma.Decimal("300.00") } },
  { mensajeroId: "m-d", tipo: "devengo", _sum: { monto: new Prisma.Decimal("500.00") } },
  { mensajeroId: "m-b", tipo: "devengo", _sum: { monto: new Prisma.Decimal("60.00") } },
  { mensajeroId: "m-b", tipo: "pago", _sum: { monto: new Prisma.Decimal("10.00") } },
];

const USUARIOS = [
  { id: "m-a", nombre: "Ana Mensajera" },
  { id: "m-b", nombre: "Bruno Díaz" },
  { id: "m-c", nombre: "Carlos Mensajero" },
  { id: "m-d", nombre: "José Pérez" },
];

function prismaFalso(grupos: unknown[] = GRUPOS, usuarios: unknown[] = USUARIOS) {
  const groupBy = vi.fn(async (_args?: Record<string, unknown>) => grupos);
  const findMany = vi.fn(async (_args?: Record<string, unknown>) => usuarios);
  const cliente = {
    pagoMensajeroMovimiento: { groupBy },
    usuario: { findMany },
  };
  return {
    repo: new PagoMensajeroMovimientoRepository(cliente as unknown as PrismaClient),
    groupBy,
    findMany,
  };
}

describe("consultas del listado paginado de cuentas por pagar (T L.1)", () => {
  it("la agregación del dinero NO lleva where, ni take, ni skip: mira el libro entero (R49)", async () => {
    const { repo, groupBy } = prismaFalso();

    await repo.listarCuentasPorPagarPaginado({ busqueda: "ana" }, RANGO);

    expect(groupBy).toHaveBeenCalledTimes(1);
    const args = groupBy.mock.calls[0]![0]!;

    // La consulta es EXACTAMENTE la del listado sin paginar: agrupar por mensajero y tipo y
    // sumar el monto. Ni una clave mas.
    expect(args).toEqual({ by: ["mensajeroId", "tipo"], _sum: { monto: true } });
    expect(args.where).toBeUndefined(); // ni el filtro de nombre ni ningun otro recorte
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it("los nombres se piden para TODO el conjunto, no para la página (R45)", async () => {
    // Si los nombres se pidieran solo de la pagina, la busqueda por nombre no podria ver el
    // conjunto: es la misma regresion que esta tanda evita, un piso mas abajo.
    const { repo, findMany } = prismaFalso();

    await repo.listarCuentasPorPagarPaginado({ busqueda: "bruno" }, { skip: 0, take: 1 });

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]![0]!;
    expect(args.where).toEqual({ id: { in: ["m-c", "m-a", "m-d", "m-b"] } }); // los CUATRO
    expect(args.select).toEqual({ id: true, nombre: true }); // y nada mas del usuario
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });

  it("son exactamente DOS consultas: la agregación y los nombres, sin conteo aparte (R54)", async () => {
    for (const caso of [
      { filtro: {}, rango: { skip: 0, take: 25 } },
      { filtro: { busqueda: "ana" }, rango: { skip: 0, take: 1 } },
      { filtro: { busqueda: "zzz" }, rango: { skip: 0, take: 100 } },
      { filtro: {}, rango: { skip: 999, take: 5 } },
    ]) {
      const { repo, groupBy, findMany } = prismaFalso();
      await repo.listarCuentasPorPagarPaginado(caso.filtro, caso.rango);
      expect(groupBy, JSON.stringify(caso)).toHaveBeenCalledTimes(1);
      expect(findMany, JSON.stringify(caso)).toHaveBeenCalledTimes(1);
    }
  });

  it("el filtro por nombre se aplica ANTES del recorte, y el total es el del conjunto filtrado (R41, R45)", async () => {
    const { repo } = prismaFalso();

    // «mensajer» casa con «Ana Mensajera» y «Carlos Mensajero». Con take 1 la pagina trae una
    // sola fila y el total sigue diciendo 2.
    const pagina = await repo.listarCuentasPorPagarPaginado(
      { busqueda: "mensajer" },
      { skip: 0, take: 1 },
    );

    expect(pagina.items.map((r) => r.mensajeroId)).toEqual(["m-a"]);
    expect(pagina.total).toBe(2);
    expect(pagina.total).not.toBe(pagina.items.length);

    // Y la segunda pagina trae la otra: el recorte es del conjunto FILTRADO, no del entero.
    const segunda = await repo.listarCuentasPorPagarPaginado(
      { busqueda: "mensajer" },
      { skip: 1, take: 1 },
    );
    expect(segunda.items.map((r) => r.mensajeroId)).toEqual(["m-c"]);
    expect(segunda.total).toBe(2);
  });

  it("los montos de la página son los del libro entero de cada mensajero (R49)", async () => {
    const { repo } = prismaFalso();

    const pagina = await repo.listarCuentasPorPagarPaginado({ busqueda: "ana" }, { skip: 0, take: 1 });

    expect(pagina.items).toEqual([
      { mensajeroId: "m-a", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00" },
    ]);

    // Contraprueba: el listado SIN paginar declara exactamente los mismos montos para esa fila.
    const enteras = await prismaFalso().repo.listarCuentasPorPagarTodos();
    expect(enteras.find((r) => r.mensajeroId === "m-a")).toEqual(pagina.items[0]);
  });

  it("el orden no depende del orden en que la base devuelva los grupos (R51)", async () => {
    // El `groupBy` no declara `orderBy` y Postgres no garantiza el orden de sus filas. Si el
    // recorte confiara en ese orden, dos lecturas podrian solapar paginas y perder una fila —y
    // aqui la fila perdida es una cuenta por pagar que alguien tiene que liquidar.
    const alDerecho = await prismaFalso(GRUPOS).repo.listarCuentasPorPagarPaginado({}, { skip: 0, take: 10 });
    const alReves = await prismaFalso([...GRUPOS].reverse(), [...USUARIOS].reverse()).repo.listarCuentasPorPagarPaginado(
      {},
      { skip: 0, take: 10 },
    );

    const ids = alDerecho.items.map((r) => r.mensajeroId);
    expect(ids).toEqual(["m-a", "m-b", "m-c", "m-d"]);
    expect(alReves.items.map((r) => r.mensajeroId)).toEqual(ids);
  });

  it("una página más allá del final trae cero filas y el total del conjunto (R41)", async () => {
    const { repo } = prismaFalso();
    const pagina = await repo.listarCuentasPorPagarPaginado({}, { skip: 100, take: 25 });
    expect(pagina.items).toEqual([]);
    expect(pagina.total).toBe(4);
  });

  it("sin movimientos no consulta los nombres y devuelve la página vacía", async () => {
    const { repo, findMany } = prismaFalso([], []);
    const pagina = await repo.listarCuentasPorPagarPaginado({ busqueda: "ana" }, RANGO);
    expect(pagina).toEqual({ items: [], total: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });
});
