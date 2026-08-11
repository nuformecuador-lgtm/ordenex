import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { libroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.1 — R9: `WalletEgresoService` invalida el dominio financiero.
//
// LA FORMA ES EL REQUISITO (`design.md §11`). No se afirma «se llamo a `invalidar`» en ningun
// caso de este archivo: se afirma sobre la CIFRA QUE EL TABLERO SIRVE, con el escritor real de
// produccion en el paso 4 y el libro de la caja compartido entre el que escribe y el que lee
// (`_libro-financiero.ts`).
//
// MUTACION QUE LO MATA: borrar la llamada a `invalidarAnaliticaFinanciera` de
// `WalletEgresoService`. Su paso 5 sigue devolviendo la cifra anterior a su propia escritura, y
// **solo este archivo se pone rojo**. Esa es la propiedad que hace imposible cerrar la feature
// con siete escritores de ocho.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const CLIENTE = {} as never; // el `writeClient` no se usa: el doble del repo ignora la `tx`

describe("R9 · un egreso administrativo invalida la cache financiera", () => {
  it("los cinco pasos, con `registrarEgreso` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache);

    // (1) el tablero sirve la cifra de hoy
    libro.moverAlMargen("1000.00");
    expect(await libro.consultar()).toBe("1000.00");

    // (2) el libro cambia POR FUERA del escritor
    libro.moverAlMargen("500.00");
    // (3) y el tablero sigue sirviendo lo cacheado. Sin este paso el resto seria vacuo.
    expect(await libro.consultar()).toBe("1000.00");

    // (4) EL ESCRITOR REAL: un gasto variable de 250, que ademas invalida
    const r = await servicio.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "250.00", descripcion: "combustible" },
      MAESTRO,
    );
    expect(r.status).toBe("ok");

    // (5) 1000 + 500 + 250
    expect(
      await libro.consultar(),
      "la invalidacion de `WalletEgresoService` NO llego: el egreso se escribio y el tablero " +
        "financiero sigue sirviendo la cifra anterior. Nada falla; el numero se queda quieto " +
        "hasta que expire el TTL (una hora).",
    ).toBe("1750.00");
  });

  it("y el REVERSO tambien: mueve dinero igual que el alta", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache);

    // Un egreso previo, por el camino real, para poder reversarlo.
    await servicio.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "400.00", descripcion: "material" },
      MAESTRO,
    );

    // (1) el tablero cachea la cifra CON el egreso
    expect(await libro.consultar()).toBe("400.00");
    // (2) + (3): el libro cambia por fuera y el tablero sigue sirviendo lo cacheado
    libro.moverAlMargen("100.00");
    expect(await libro.consultar()).toBe("400.00");

    // (4) EL REVERSO REAL. Cubrir solo `registrarEgreso` dejaria esta mitad suelta, y el
    // reverso mueve dinero igual: es un `ingreso_ajuste` de igual monto.
    const r = await servicio.reversarEgreso({ movimientoId: "mov-0" }, MAESTRO);
    expect(r.status).toBe("ok");

    // (5) 400 (el egreso) + 100 (el del paso 2) + 400 (el `ingreso_ajuste` del reverso, que
    // entra en el BRUTO de `egresos` y se resta en el NETO — R20 de la 183). La cifra servida
    // cambia porque la cache se vacio: si el reverso no invalidara, seguiria en 400.00.
    expect(await libro.consultar()).toBe("900.00");
  });

  it("un reverso YA aplicado no invalida: no escribio nada", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache);
    await servicio.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "400.00", descripcion: "material" },
      MAESTRO,
    );
    await servicio.reversarEgreso({ movimientoId: "mov-0" }, MAESTRO);

    const invalidacionesAntes = libro.cache.invalidaciones.length;
    const segundo = await servicio.reversarEgreso({ movimientoId: "mov-0" }, MAESTRO);

    expect(segundo.status).toBe("already_reversed");
    // Vaciar la cache financiera por una operacion que fue no-op es coste sin motivo.
    expect(libro.cache.invalidaciones).toHaveLength(invalidacionesAntes);
  });

  it("registra SU propio origen, no uno generico (R24)", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache);

    await servicio.registrarEgreso(
      { tipoEgreso: "sueldo", monto: "900.00", descripcion: "quincena" },
      MAESTRO,
    );

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_egreso_admin"]);
  });

  it("un `forbidden` no escribe ni invalida", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletEgresoService(libro.cajaRepo, CLIENTE, libro.cache);

    const r = await servicio.registrarEgreso(
      { tipoEgreso: "gasto_variable", monto: "250.00", descripcion: "x" },
      { usuarioId: "u-mensajero", rol: "mensajero" },
    );

    expect(r.status).toBe("forbidden");
    expect(libro.filas()).toHaveLength(0);
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R9 · el composition root de produccion pasa el puerto de verdad", () => {
  // El default del parametro es `cacheNula()` para no romper las suites de la 45. Ese default
  // NO lo cubre el tipo: si `buildService` se olvidara de pasar el puerto real, la invalidacion
  // no ocurriria en produccion y NADA fallaria. Lo cubre esto.
  it("`buildService` de `lib/actions/wallet-egresos.ts` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, "lib", "actions", "wallet-egresos.ts"),
      "utf8",
    );
    expect(fuente).toMatch(/new WalletEgresoService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
