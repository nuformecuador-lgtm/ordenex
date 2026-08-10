import { describe, expect, it } from "vitest";

import { TableroDiaService } from "@/lib/services/TableroDiaService";

import { RepositorioDoble, fila } from "./_doble-tablero-dia";

// Feature 192 (B3.4) — R25, R28, R29, R30.
//
// El orden de las tarjetas y los totales los calcula el SERVICIO, con funciones puras y sin
// base de datos. Los totales se suman sobre las filas que SE PINTAN (no los pide la base) para
// que sean por construccion la suma de lo que el usuario ve, y para que la identidad de ocho
// sumandos de R25 se herede de cada tarjeta al bloque de totales.

const AHORA = new Date("2026-08-08T19:00:00.000Z");
const ADMIN = { usuarioId: "u-1", rol: "admin", zonaId: null };

async function tableroDe(filas: ReturnType<typeof fila>[]) {
  const service = new TableroDiaService(new RepositorioDoble(() => filas));
  const resultado = await service.obtener(ADMIN, AHORA);
  if (resultado.estado !== "ok") throw new Error("se esperaba ok");
  return resultado.tablero;
}

describe("TableroDiaService — filas y totales", () => {
  it("ordena por asignadas DESC y, a igualdad, por nombre ASC (R29)", async () => {
    const tablero = await tableroDe([
      fila("m-zoe", "Zoe Zamora", { entregadas: 3 }),
      fila("m-ana", "Ana Aguilar", { entregadas: 3 }),
      fila("m-max", "Max Mora", { entregadas: 9 }),
    ]);

    expect(tablero.filas.map((f) => f.mensajeroNombre)).toEqual([
      "Max Mora",
      "Ana Aguilar",
      "Zoe Zamora",
    ]);
  });

  it("el orden es determinista aunque el nombre tambien empate", async () => {
    const filas = [fila("m-b", "Ana Aguilar"), fila("m-a", "Ana Aguilar")].map((f) => ({
      ...f,
      entregadas: 1,
      asignadas: 1,
    }));
    const tablero = await tableroDe(filas);
    expect(tablero.filas.map((f) => f.mensajeroId)).toEqual(["m-a", "m-b"]);
  });

  it("los totales son la suma exacta de las filas pintadas (R30)", async () => {
    const tablero = await tableroDe([
      fila("m1", "Ana", { entregadas: 2, sinRecoger: 1, otros: 1 }),
      fila("m2", "Beto", { reprogramadas: 1, devueltas: 1, enReparto: 2 }),
      fila("m3", "Caro", { rechazadas: 1, incidentes: 1 }),
    ]);

    expect(tablero.totales).toEqual({
      asignadas: 10,
      entregadas: 2,
      reprogramadas: 1,
      devueltas: 1,
      rechazadas: 1,
      incidentes: 1,
      sinRecoger: 1,
      enReparto: 2,
      otros: 1,
    });
  });

  it("la identidad de ocho sumandos se cumple en cada tarjeta y en los totales (R25)", async () => {
    const tablero = await tableroDe([
      fila("m1", "Ana", { entregadas: 2, sinRecoger: 1, otros: 1 }),
      fila("m2", "Beto", { reprogramadas: 1, devueltas: 1, enReparto: 2 }),
    ]);

    const suma = (f: {
      entregadas: number;
      reprogramadas: number;
      devueltas: number;
      rechazadas: number;
      incidentes: number;
      sinRecoger: number;
      enReparto: number;
      otros: number;
    }): number =>
      f.entregadas +
      f.reprogramadas +
      f.devueltas +
      f.rechazadas +
      f.incidentes +
      f.sinRecoger +
      f.enReparto +
      f.otros;

    for (const f of tablero.filas) expect(f.asignadas).toBe(suma(f));
    expect(tablero.totales.asignadas).toBe(suma(tablero.totales));
  });

  it("sin ordenes hoy devuelve un tablero VACIO en ok, no un denegado ni un error (R33)", async () => {
    const tablero = await tableroDe([]);

    expect(tablero.filas).toEqual([]);
    expect(tablero.totales.asignadas).toBe(0);
    expect(tablero.fecha).toBe("2026-08-08");
  });

  it("expone la fecha calendario CR del dia y el instante en que se leyeron los datos (R34)", async () => {
    const tablero = await tableroDe([fila("m1", "Ana", { entregadas: 1 })]);

    expect(tablero.fecha).toBe("2026-08-08");
    expect(tablero.generadoAt).toBe(AHORA.toISOString());
  });
});
