import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GastoFijoPlantillaRepository } from "@/lib/repositories/GastoFijoPlantillaRepository";

/**
 * Ficha 332 (R3/R8) — el `WHERE` del borrado de plantillas, probado DONDE VIVE.
 *
 * Por que este archivo existe y no basta el test del servicio: alli el repositorio es un
 * `vi.fn()`, asi que lo unico que se puede afirmar es «se llamo a `eliminar` con este id». El
 * `where` que de verdad viaja a Postgres queda fuera de su alcance, y en este repo ya esta medido
 * cuatro veces que una mutacion del `WHERE` deja esos tests en verde. Aqui el doble es el
 * DELEGADO de Prisma: captura los argumentos de `deleteMany` y ademas los APLICA sobre una tienda
 * en memoria, de modo que borrar de mas se ve en las filas que quedan, no solo en un `toEqual`.
 *
 * Las tres afirmaciones:
 *   (a) filtra por el id EXACTO y por ninguna otra columna — literal `{ where: { id } }`;
 *   (b) `count 0` (la fila ya no estaba) -> `false`, sin lanzar;
 *   (c) el cliente solo expone `gastoFijoPlantilla`: cualquier otro modelo revienta el test.
 *       Es el testigo VIVO de R8 — el libro (`wallet_movimiento`) no se toca al borrar—, que en
 *       produccion garantiza el tipo `Pick<PrismaClient, "gastoFijoPlantilla">`.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";

interface ArgsDeleteMany {
  where?: { id?: string } & Record<string, unknown>;
}

/**
 * Delegado que RECUERDA con que se le llamo y ADEMAS ejecuta el filtro sobre una tienda en
 * memoria. Lo segundo es lo que vuelve imposible un verde de conveniencia: con `where: {}` el
 * delegado borraria las dos filas y el caso de abajo lo dice con nombre y apellido.
 */
function delegadoConFilas(ids: string[]) {
  const filas = [...ids];
  const deleteMany = vi.fn(async (args?: ArgsDeleteMany) => {
    const idPedido = args?.where?.id;
    const sobrevivientes = idPedido === undefined ? [] : filas.filter((f) => f !== idPedido);
    const count = filas.length - sobrevivientes.length;
    filas.length = 0;
    filas.push(...sobrevivientes);
    return { count };
  });
  return { deleteMany, filasRestantes: () => [...filas] };
}

/** Delegado sin filas: `deleteMany` siempre responde `count 0`. */
function delegadoVacio() {
  return { deleteMany: vi.fn(async (_args?: ArgsDeleteMany) => ({ count: 0 })) };
}

/**
 * Cliente Prisma que SOLO deja pasar `gastoFijoPlantilla`. Tocar cualquier otro modelo lanza, con
 * el nombre del modelo dentro del mensaje: si algun dia el borrado quisiera «limpiar» el libro,
 * el test no falla por un `expect` sutil sino por una excepcion que dice cual tabla se toco.
 */
function clienteSoloPlantillas(gastoFijoPlantilla: unknown): PrismaClient {
  return new Proxy({} as Record<string, unknown>, {
    get(_objetivo, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop !== "gastoFijoPlantilla") {
        throw new Error(
          `R8: el repositorio de plantillas toco otro modelo de Prisma ("${prop}"). El borrado ` +
            "de una plantilla no puede crear, modificar ni eliminar movimientos del libro.",
        );
      }
      return gastoFijoPlantilla;
    },
  }) as unknown as PrismaClient;
}

describe("GastoFijoPlantillaRepository.eliminar — el WHERE (ficha 332, R3/R8)", () => {
  it("(a) filtra por el id EXACTO y por ninguna otra columna", async () => {
    const delegado = delegadoConFilas([ID, OTRA]);
    const repo = new GastoFijoPlantillaRepository(clienteSoloPlantillas(delegado));

    const borrada = await repo.eliminar(ID);

    expect(borrada).toBe(true);
    expect(delegado.deleteMany).toHaveBeenCalledTimes(1);

    // El literal: `{ where: { id } }` y nada mas. Una clave de mas o de menos lo pone rojo.
    expect(delegado.deleteMany).toHaveBeenCalledWith({ where: { id: ID } });

    // Y lo mismo desmontado, para que el rojo diga QUE sobra o falta cuando llegue el dia.
    const args = delegado.deleteMany.mock.calls[0]![0];
    expect(args).toBeDefined();
    expect(Object.keys(args!)).toEqual(["where"]);
    expect(Object.keys(args!.where!)).toEqual(["id"]);
    expect(args!.where!.id).toBe(ID);
  });

  it("(a-bis) R3: borra EXACTAMENTE esa fila; la otra plantilla sigue en la tabla", async () => {
    const delegado = delegadoConFilas([ID, OTRA]);
    const repo = new GastoFijoPlantillaRepository(clienteSoloPlantillas(delegado));

    await repo.eliminar(ID);

    // Este es el caso que un `where: {}` no puede sobrevivir: borraria las dos.
    expect(delegado.filasRestantes()).toEqual([OTRA]);
  });

  it("(b) la fila ya no existia (count 0) -> false, sin lanzar", async () => {
    const delegado = delegadoVacio();
    const repo = new GastoFijoPlantillaRepository(clienteSoloPlantillas(delegado));

    await expect(repo.eliminar(ID)).resolves.toBe(false);
    expect(delegado.deleteMany).toHaveBeenCalledWith({ where: { id: ID } });
  });

  it("(c) R8: el cliente solo expone `gastoFijoPlantilla` — tocar el libro revienta", async () => {
    const delegado = delegadoConFilas([ID]);
    const cliente = clienteSoloPlantillas(delegado);

    // Autocomprobacion del detector: el guardia de arriba tiene que SABER fallar. Sin esto, un
    // proxy mal escrito dejaria pasar cualquier tabla en silencio y el caso valdria cero.
    expect(() => (cliente as unknown as Record<string, unknown>).walletMovimiento).toThrow(
      /walletMovimiento/,
    );

    // Y con el detector armado, el borrado real pasa por el sin despertarlo.
    const repo = new GastoFijoPlantillaRepository(cliente);
    await expect(repo.eliminar(ID)).resolves.toBe(true);
  });
});
