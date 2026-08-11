import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WalletService } from "@/lib/services/WalletService";
import { libroFinanciero } from "./_libro-financiero";

// Feature 179 / T3.2 — R10: `WalletService.registrarMovimientoManual` invalida.
//
// ⚠ ESTE ESCRITOR NO ESTABA EN LA LISTA DE LA FICHA (`requirements.md §0.a`). Es el hallazgo que
// justifica que el mecanismo de vigilancia de esta feature sea un CENSO DEL ARBOL (R17) y no una
// lista de rutas: un ingreso o egreso de caja que un maestro mete a mano entra en `egresos`,
// `dinero_en_caja` y `ganancia_ordenex`. Sin este archivo, la 179 reintroduciria exactamente el
// modo de fallo que D2 de la 128 rechazo — servir dinero rancio en silencio— y no habria nada
// que lo dijera.
//
// MUTACION QUE LO MATA: borrar la invalidacion de `registrarMovimientoManual`. Solo este archivo
// se pone rojo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const CLIENTE = {} as never;

describe("R10 · un movimiento manual de caja invalida la cache financiera", () => {
  it("los cinco pasos, con `registrarMovimientoManual` real en el paso 4", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletService(libro.cajaRepo, CLIENTE, libro.cache);

    // (1)
    libro.moverAlMargen("2000.00");
    expect(await libro.consultar()).toBe("2000.00");

    // (2) el libro cambia por fuera + (3) el tablero sigue sirviendo lo cacheado
    libro.moverAlMargen("300.00");
    expect(await libro.consultar()).toBe("2000.00");

    // (4) EL ESCRITOR REAL
    const r = await servicio.registrarMovimientoManual(
      {
        tipo: "egreso",
        categoria: "egreso_ajuste",
        monto: "700.00",
        descripcion: "ajuste manual de caja",
      },
      MAESTRO,
    );
    expect(r.status).toBe("ok");

    // (5) 2000 + 300 + 700
    expect(
      await libro.consultar(),
      "la invalidacion de `WalletService.registrarMovimientoManual` NO llego. Es el escritor " +
        "que la ficha se dejo fuera: sin el, un maestro mueve la caja a mano y el tablero " +
        "financiero sigue mintiendo hasta una hora.",
    ).toBe("3000.00");
  });

  it("registra SU propio origen, no uno generico (R24)", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletService(libro.cajaRepo, CLIENTE, libro.cache);

    await servicio.registrarMovimientoManual(
      { tipo: "ingreso", categoria: "ingreso_ajuste", monto: "50.00", descripcion: "x" },
      MAESTRO,
    );

    expect(libro.cache.invalidaciones.map((i) => i.origen)).toEqual(["ledger_movimiento_manual"]);
  });

  it("un `forbidden` no escribe ni invalida", async () => {
    const libro = libroFinanciero();
    const servicio = new WalletService(libro.cajaRepo, CLIENTE, libro.cache);

    const r = await servicio.registrarMovimientoManual(
      { tipo: "egreso", categoria: "egreso_ajuste", monto: "700.00", descripcion: "x" },
      { usuarioId: "u-tienda", rol: "adminTienda" },
    );

    expect(r.status).toBe("forbidden");
    expect(libro.filas()).toHaveLength(0);
    expect(libro.cache.invalidaciones).toHaveLength(0);
  });
});

describe("R10 · el composition root de produccion pasa el puerto de verdad", () => {
  it("`buildService` de `lib/actions/wallet.ts` construye con `crearAnaliticaCacheDeNext()`", () => {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, "lib", "actions", "wallet.ts"), "utf8");
    expect(fuente).toMatch(/new WalletService\([\s\S]*?crearAnaliticaCacheDeNext\(\)/);
  });
});
