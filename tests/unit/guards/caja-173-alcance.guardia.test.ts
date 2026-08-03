import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 173 / T C.5 (R31, R33) — GUARDIA DE ALCANCE: **los otros dos libros no ganan filas, y
 * las dos cifras de la caja no pueden leerlos.**
 *
 * El riesgo que este archivo persigue es el doble conteo, y tiene dos caras:
 *
 *  - **Escribir de mas** (R31). El dinero que la 173 mueve ya esta contado en el ledger por
 *    tienda (el debito `pago_tienda` de la 172) y en el libro del mensajero. Si la feature
 *    añadiera una fila mas alli, el saldo a favor de la tienda bajaria DOS veces por el mismo
 *    pago y nadie lo notaria hasta que una tienda reclamara.
 *  - **Leer de mas** (R33). Si el repositorio que sirve «dinero en caja» y «ganancia» pudiera
 *    consultar los otros dos libros, existiria una segunda fuente para un numero de dinero, que
 *    es exactamente lo que `AnaliticaFinancieraService` prohibe por escrito: «no da un error, da
 *    una discusion».
 *
 * Las dos se miden sobre el ARBOL, no sobre una llamada concreta: un test de comportamiento solo
 * dice que ESE camino no escribio de mas; un censo dice que no hay ningun otro camino.
 *
 * `T H.2` amplia este archivo con el resto de la revision de alcance (R66-R68).
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Las escrituras de Prisma. `create` incluido: el censo persigue TODA forma de insertar. */
const ESCRITURAS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

/**
 * Los DOS libros que esta feature NO toca. Se nombran por su delegado de Prisma, que es como
 * aparecen en el codigo; el nombre de la tabla va al lado para que el fallo se lea sin traducir.
 */
const LIBROS_AJENOS: { delegado: string; tabla: string; escritor: string }[] = [
  {
    delegado: "walletTiendaMovimiento",
    tabla: "wallet_tienda_movimiento",
    escritor: "lib/repositories/WalletTiendaMovimientoRepository.ts",
  },
  {
    delegado: "pagoMensajeroMovimiento",
    tabla: "pago_mensajero_movimiento",
    escritor: "lib/repositories/PagoMensajeroMovimientoRepository.ts",
  },
];

/** Todos los `.ts` de una carpeta del repo, recursivamente. */
function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

const FUENTES = [...fuentesDe("lib"), ...fuentesDe("scripts")];

describe("R31 — ninguna escritura NUEVA en el ledger por tienda ni en el libro del mensajero", () => {
  for (const libro of LIBROS_AJENOS) {
    it(`el unico modulo del arbol que escribe en \`${libro.tabla}\` sigue siendo su repositorio`, () => {
      const escritores = FUENTES.filter((ruta) => {
        const codigo = codigoSinComentarios(ruta);
        return ESCRITURAS.some((m) =>
          new RegExp(`${libro.delegado}\\.${m}\\s*\\(`).test(codigo),
        );
      });

      // Uno, y exactamente uno. Si la 173 —o cualquier feature futura— abriera un segundo camino
      // de escritura, este censo lo nombra en el mensaje del fallo.
      expect(escritores).toEqual([libro.escritor]);
    });
  }

  it("los tres modulos NUEVOS de la 173 no escriben en ningun libro que no sea la caja", () => {
    const nuevos = [
      "lib/services/CajaCodFeedService.ts",
      "lib/services/CajaPagoTiendaFeedService.ts",
      "lib/utils/caja-tesoreria.ts",
    ];

    for (const ruta of nuevos) {
      const codigo = codigoSinComentarios(ruta);
      for (const libro of LIBROS_AJENOS) {
        for (const metodo of ESCRITURAS) {
          expect(codigo, `${ruta} escribe en ${libro.tabla}`).not.toMatch(
            new RegExp(`${libro.delegado}\\.${metodo}\\s*\\(`),
          );
        }
      }
    }
  });

  it("el feed del contra-entrega solo LEE el ledger por tienda (`findMany`), nunca escribe", () => {
    const codigo = codigoSinComentarios("lib/services/CajaCodFeedService.ts");

    // Es el unico modulo de la 173 que toca el ledger, y lo toca de una sola forma.
    const usos = [...codigo.matchAll(/walletTiendaMovimiento\.(\w+)/g)].map((m) => m[1]);
    expect(usos).toEqual(["findMany"]);
  });
});

describe("R33 — el repositorio que sirve las dos cifras NO puede leer los otros libros", () => {
  it("su cliente Prisma es MINIMO: `walletMovimiento` y nada mas (comprobado compilando)", () => {
    // Este objeto tiene UNA sola tabla. Que la linea de abajo compile es la prueba: si el
    // repositorio necesitara `walletTiendaMovimiento` o `pagoMensajeroMovimiento`, `tsc` la
    // rechazaria y el gate caeria antes que este test.
    const clienteDeUnaSolaTabla = {
      walletMovimiento: {} as PrismaClient["walletMovimiento"],
    };
    const repo = new WalletMovimientoRepository(clienteDeUnaSolaTabla);

    expect(repo).toBeInstanceOf(WalletMovimientoRepository);
  });

  it("y su fuente lo declara asi, sin nombrar ninguna otra tabla de dinero", () => {
    const codigo = codigoSinComentarios("lib/repositories/WalletMovimientoRepository.ts");

    expect(codigo).toMatch(/Pick<PrismaClient,\s*"walletMovimiento">/);
    for (const ajena of ["walletTiendaMovimiento", "pagoMensajeroMovimiento", "gestionOrden", "cierreDia"]) {
      expect(codigo, `WalletMovimientoRepository nombra ${ajena}`).not.toContain(ajena);
    }
  });

  it("la derivacion de las dos cifras es PURA: no conoce ningun cliente ni ningun repositorio", () => {
    const codigo = codigoSinComentarios("lib/utils/caja-tesoreria.ts");

    for (const prohibido of ["PrismaClient", "Repository", "findMany", "groupBy", "await"]) {
      expect(codigo, `caja-tesoreria.ts nombra ${prohibido}`).not.toContain(prohibido);
    }
  });

  it("el puerto de la liquidacion tambien esta acotado a la caja", () => {
    const contrato = codigoSinComentarios("lib/interfaces/services/ICajaPagoTiendaFeedService.ts");

    expect(contrato).toMatch(/Pick<PrismaClient,\s*"walletMovimiento">/);
    for (const libro of LIBROS_AJENOS) {
      expect(contrato, `el puerto alcanza ${libro.tabla}`).not.toContain(libro.delegado);
    }
  });
});
