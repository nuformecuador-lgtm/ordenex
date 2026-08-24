import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";
import type { GestionResultado } from "@prisma/client";

import {
  RESULTADOS_PERMITIDOS_EN_EL_TOPE,
  alcanzaElTope,
  permitidoEnElTope,
} from "@/lib/types/tope-intentos";

// Feature 273 (T1, R3/R7) — EL PUNTO UNICO DE LA REGLA, probado como lo que es: una lista de
// INCLUSION y una comparacion con `>=`.
//
// Lo que este archivo protege, y por que cada caso existe:
//   1. la lista fijada por IGUALDAD DE CONTENIDO: ensancharla tiene que costar un rojo, porque
//      admitir un desenlace mas en el tope es admitir una vuelta mas a circulacion;
//   2. los DOS prohibidos, nombrados;
//   3. la lista probada como INCLUSION recorriendo TODOS los values del enum: si alguien la
//      convirtiera en lista negra, un resultado futuro quedaria admitido solo y este caso no lo
//      veria a menos que recorra el enum entero;
//   4. `>=` y no `===` en `alcanzaElTope`, con dos umbrales distintos para que ningun `3` a mano
//      pueda pasar;
//   5. el fichero NO nombra la configuracion (R10, molde de `intentos-entrega.test.tsx:171`).

/**
 * Los CINCO values del enum `GestionResultado`, escritos a mano. Es el contrato, no una copia de
 * su propia fuente: si el enum ganara un sexto valor este arreglo se quedaria corto, y el caso 3
 * dejaria de recorrerlo entero — por eso el propio caso 3 comprueba primero que la lista de
 * permitidos este CONTENIDA aqui, que es lo que se pone rojo si alguien añade un value y se olvida
 * de decidir si entra o no en el tope.
 */
const TODOS_LOS_RESULTADOS: GestionResultado[] = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
];

describe("273/T1 · `RESULTADOS_PERMITIDOS_EN_EL_TOPE` (R3)", () => {
  it("1. es EXACTAMENTE los tres values, por igualdad de contenido", () => {
    // ⚠️ LITERAL A PROPOSITO, y no derivado de su propia fuente: ESTE es el contrato. Ensanchar la
    // lista —añadir `reprogramada` o `devuelta`— vuelve a abrir la vuelta a circulacion que la
    // ficha 273 existe para cerrar, y tiene que costar un rojo aqui antes de costar dinero alla.
    expect([...RESULTADOS_PERMITIDOS_EN_EL_TOPE]).toEqual(["entregada", "rechazada", "incidente"]);
  });

  it("2. los DOS que devuelven la orden a circulacion NO estan permitidos", () => {
    expect(permitidoEnElTope("reprogramada")).toBe(false);
    expect(permitidoEnElTope("devuelta")).toBe(false);
  });

  it("3. es una lista de INCLUSION: todo value del enum fuera de ella da `false`", () => {
    // Red previa: si el enum crece y nadie toca este archivo, la lista de permitidos podria
    // contener algo que `TODOS_LOS_RESULTADOS` no enumera y el recorrido de abajo mentiria.
    for (const permitido of RESULTADOS_PERMITIDOS_EN_EL_TOPE) {
      expect(TODOS_LOS_RESULTADOS).toContain(permitido);
    }
    // El recorrido: cada value del enum, uno a uno, y su veredicto derivado de la PERTENENCIA a la
    // lista. Con lista negra, un value nuevo daria `true` aqui sin que nadie lo decidiera.
    for (const resultado of TODOS_LOS_RESULTADOS) {
      const esperado = (RESULTADOS_PERMITIDOS_EN_EL_TOPE as readonly string[]).includes(resultado);
      expect(permitidoEnElTope(resultado)).toBe(esperado);
    }
    // Y el conteo cierra la cuenta: 3 permitidos, 2 prohibidos, cinco values.
    expect(TODOS_LOS_RESULTADOS.filter((r) => permitidoEnElTope(r))).toHaveLength(3);
    expect(TODOS_LOS_RESULTADOS.filter((r) => !permitidoEnElTope(r))).toHaveLength(2);
  });
});

describe("273/T1 · `alcanzaElTope` (R1/R7)", () => {
  it("4a. con umbral 3: 1 -> false, 2 -> true, 3 -> true, 4 -> true", () => {
    // El `3 -> true` y el `4 -> true` son los que exigen `>=` en vez de `===`: los datos heredados
    // pueden estar POR ENCIMA del umbral (la ficha nace de una orden con 3 intentos que seguia
    // circulando) y esos tambien tienen que quedar bloqueados.
    expect(alcanzaElTope(0, 3)).toBe(false);
    expect(alcanzaElTope(1, 3)).toBe(false);
    expect(alcanzaElTope(2, 3)).toBe(true);
    expect(alcanzaElTope(3, 3)).toBe(true);
    expect(alcanzaElTope(4, 3)).toBe(true);
  });

  it("4b. con umbral 5: 3 -> false, 4 -> true (el umbral NO esta escrito dentro)", () => {
    // Con un `3` a mano en la implementacion, `alcanzaElTope(3, 5)` daria `true` y este caso caeria.
    expect(alcanzaElTope(3, 5)).toBe(false);
    expect(alcanzaElTope(4, 5)).toBe(true);
    expect(alcanzaElTope(5, 5)).toBe(true);
  });
});

describe("273/T1 · el modulo NO se lleva la configuracion al cliente (R10)", () => {
  it("5. el fichero no nombra `MIN_INTENTOS_ENTREGA` ni `reintentosConfig`", () => {
    // Molde: `tests/unit/components/intentos-entrega.test.tsx:171`. Este modulo es importable desde
    // un Client Component (la UI filtra los botones con `permitidoEnElTope`); si importara la
    // configuracion, el umbral cruzaria al navegador con el.
    const fuente = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "lib", "types", "tope-intentos.ts"),
      "utf8",
    );
    // El comentario de cabecera SI los nombra —explica por que NO se importan—, asi que lo que se
    // mira es el codigo con los comentarios retirados.
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(codigo).not.toContain("reintentosConfig");
    expect(codigo).not.toContain("MIN_INTENTOS_ENTREGA");
    expect(codigo).not.toContain("@/lib/config/reintentos");
    // Y ningun import de servidor: ni Prisma en runtime, ni servicios, ni `next/*`.
    expect(codigo).not.toMatch(/from "next\//);
    expect(codigo).not.toMatch(/from "@\/lib\/(services|repositories|db)\//);
    // Lo unico que se importa de Prisma es el `type` (borrado en compilacion).
    expect(codigo).toMatch(/import type \{ GestionResultado \} from "@prisma\/client";/);
  });
});
