import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { WITH_DETALLE } from "@/lib/repositories/CierreDiaRepository";
import { GESTION_ADMIN_SELECT } from "@/lib/repositories/CierresAdminRepository";
import { codigoSinComentarios } from "../../fixtures/money-safe";

/**
 * Feature 208 / T14 (R23) — GUARDIA DE PROYECCIÓN: **toda proyección Prisma que alimente un
 * `CierreGestionPendienteRow` selecciona el desglose `pagos`.**
 *
 * Por qué esto es una guardia y no un test de repositorio. `pagos` es OBLIGATORIO en la fila de
 * dominio y NO tiene fallback al par escalar (`montoRecibido`/`metodoPago`), a propósito
 * (design §3.1, alternativa descartada B). `computeTotales` suma EXCLUSIVAMENTE esas líneas, así
 * que una proyección que se olvide de pedirlas no da un total «plausible»: da CERO. Y
 * `cierre_dia.total_efectivo` es la `E` del `min(P, E)` del pago al mensajero (feature 44), o sea
 * que ese cero se convierte en dinero mal pagado a una persona.
 *
 * Un test de repositorio prueba que ESE camino trae el desglose. Lo que hace falta aquí es la
 * afirmación de que no hay NINGÚN otro camino: el censo va sobre el árbol, no sobre una llamada.
 * Y ningún grafo de imports selecciona esta comprobación —no importa lo que vigila en el sentido
 * en que lo vigila—, que es exactamente la razón por la que `test:guardias` corre siempre
 * (`docs/verification.md`).
 *
 * Las DOS proyecciones de aquí abajo cubren los TRES caminos de R23:
 *
 *  - `CierreDiaRepository.WITH_DETALLE` → vista EN VIVO del mensajero;
 *  - `CierresAdminRepository.GESTION_ADMIN_SELECT` → detalle de cierres de ADMIN **y** de
 *    BODEGA, porque `CierresBodegaAdminRepository` la REUSA en vez de tener una copia propia.
 *    Esa reutilización es la mitad del requisito: una copia que naciera sin `pagos` dejaría el
 *    tercer camino en cero sin tocar ninguno de los otros dos, y por eso se afirma explícitamente.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** El `select` de una proyección, sin el tipado literal: aquí se mide lo que HAY, no lo que TS cree. */
type Select = Record<string, unknown>;

/**
 * Las dos definiciones vivas, importadas de VERDAD. No se leen como texto: se leen como objeto,
 * así que renombrar la clave, cambiar el `orderBy` o borrar el bloque cae aquí con el valor real
 * a la vista, y no depende de cómo esté formateado el archivo.
 */
const PROYECCIONES: { nombre: string; select: Select; archivo: string }[] = [
  {
    nombre: "CierreDiaRepository.WITH_DETALLE",
    select: WITH_DETALLE.select as Select,
    archivo: "lib/repositories/CierreDiaRepository.ts",
  },
  {
    nombre: "CierresAdminRepository.GESTION_ADMIN_SELECT",
    select: GESTION_ADMIN_SELECT as Select,
    archivo: "lib/repositories/CierresAdminRepository.ts",
  },
];

/** Lo que una proyección del desglose tiene que pedir, exactamente. */
const SELECT_DE_PAGOS = { metodo: true, monto: true };

/**
 * R22: el orden determinista. Sobre un enum NATIVO de Postgres, `asc` es el orden de
 * DECLARACIÓN (`efectivo`, `SINPE`, `transferencia`), que es lo que estabiliza la concatenación
 * de las descargas [D4] y las aserciones de los tests. Sin `orderBy`, el orden sería el físico.
 */
const ORDER_BY_DE_PAGOS = { metodo: "asc" };

/** Todos los `.ts`/`.tsx` de una carpeta del repo, recursivamente. */
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

const FUENTES_DE_LIB = fuentesDe("lib");

/**
 * Las declaraciones `const X = { … } as const;` de un fuente, con su nombre. El `as const;` es
 * el cierre: ningún objeto ANIDADO termina en `as const;`, así que el no-greedy para justo al
 * final de la declaración y no antes.
 *
 * El lookahead que prohíbe otro `const … =` dentro del cuerpo NO es adorno: sin él, una
 * declaración que NO lleva `as const` (las hay en estos archivos) se traga a la siguiente que sí
 * lo lleva, y el barrido acaba atribuyendo un cuerpo al nombre equivocado. Se midió: con la
 * versión ingenua, una copia de proyección inyectada en `CierresBodegaAdminRepository` salía
 * reportada como `ORDEN_CIERRES_BODEGA_ADMIN`.
 */
function declaracionesConst(codigo: string): { nombre: string; cuerpo: string }[] {
  const declaracion = /const\s+(\w+)\s*=\s*(\{(?:(?!\bconst\s+\w+\s*=)[\s\S])*?\})\s*as const;/g;
  return [...codigo.matchAll(declaracion)].map((m) => ({ nombre: m[1], cuerpo: m[2] }));
}

describe("R23 — las proyecciones que producen la fila de cierre traen el desglose", () => {
  for (const proyeccion of PROYECCIONES) {
    it(`\`${proyeccion.nombre}\` selecciona \`pagos\` con su método, su monto y su orden`, () => {
      const pagos = proyeccion.select.pagos as
        | { select?: unknown; orderBy?: unknown }
        | undefined;

      // El mensaje nombra la proyección: borrar `pagos:` de una de las dos dice CUÁL falta.
      expect(pagos, `${proyeccion.nombre} no selecciona \`pagos\``).toBeDefined();
      expect(pagos?.select, `${proyeccion.nombre}: el select de \`pagos\``).toEqual(
        SELECT_DE_PAGOS,
      );
      expect(pagos?.orderBy, `${proyeccion.nombre}: el orden de \`pagos\` (R22)`).toEqual(
        ORDER_BY_DE_PAGOS,
      );
    });

    it(`\`${proyeccion.nombre}\` CONSERVA el par escalar junto al desglose (R31)`, () => {
      // Control de no-vacuidad de lo de arriba —si se estuviera midiendo un objeto vacío, la
      // ausencia de `pagos` no probaría nada— y a la vez R31: el desglose se AÑADE, no
      // sustituye. `metodoPago` sobrevive hasta que la 209 decida retirarlo, y mientras tanto
      // la presentación actual sigue funcionando entre los dos merges.
      expect(proyeccion.select.montoRecibido).toBe(true);
      expect(proyeccion.select.metodoPago).toBe(true);
      expect(proyeccion.select.resultado).toBe(true);
    });
  }

  it("el censo de productores de la fila está CERRADO: solo esos dos mappers la construyen", () => {
    // Si una feature futura abriera un tercer mapper —un cuarto camino de lectura—, su
    // proyección quedaría fuera de las dos comprobadas arriba y nadie miraría si pide `pagos`.
    // Este censo lo nombra en el fallo en vez de dejarlo entrar en silencio.
    const productores = FUENTES_DE_LIB.filter((ruta) =>
      /\)\s*:\s*CierreGestionPendienteRow\s*\{/.test(codigoSinComentarios(ruta)),
    );

    expect(productores.sort()).toEqual([
      "lib/repositories/CierreDiaRepository.ts",
      "lib/repositories/CierresAdminRepository.ts",
    ]);
  });

  it("NINGUNA proyección de `lib/` pide el método escalar sin pedir también el desglose", () => {
    // La red genérica, y la razón de que sea `metodoPago: true` y no `montoRecibido: true`:
    // `WalletTiendaFeedService` proyecta `montoRecibido` A PROPÓSITO y sin el método (R33: solo
    // el total), así que perseguir el monto daría un falso positivo garantizado. Lo que el
    // desglose sustituye es el MÉTODO escalar: quien lo pida, está leyendo el recaudo por
    // método y tiene que pedir las líneas.
    const infractoras: string[] = [];
    let vistas = 0;
    for (const ruta of FUENTES_DE_LIB) {
      for (const decl of declaracionesConst(codigoSinComentarios(ruta))) {
        if (!/\bmetodoPago:\s*true\b/.test(decl.cuerpo)) continue;
        vistas += 1;
        if (!/\bpagos:\s*\{/.test(decl.cuerpo)) infractoras.push(`${ruta}: ${decl.nombre}`);
      }
    }

    // Control de no-vacuidad: si el extractor de declaraciones se rompiera, `vistas` sería 0 y
    // el `toEqual([])` de abajo pasaría sin haber mirado ni una proyección. Es un mínimo y no
    // una igualdad A PROPÓSITO: una proyección NUEVA no tiene que romper esta guardia por
    // existir — tiene que romperla por no pedir el desglose, y eso lo dice la línea siguiente
    // nombrando al infractor.
    expect(
      vistas,
      "el extractor no encontró las proyecciones con `metodoPago: true`",
    ).toBeGreaterThanOrEqual(2);
    expect(infractoras, "proyección del método escalar SIN el desglose").toEqual([]);
  });

  it("CONTRAPRUEBA: el barrido caza una proyección a la que se le quitó `pagos`", () => {
    // Sin esto, el test de arriba podría estar pasando por no mirar nada. Se le quita el
    // desglose a la proyección REAL —en memoria— y el barrido la encuentra.
    const real = codigoSinComentarios("lib/repositories/CierresAdminRepository.ts");
    const mutado = real.replace(/^\s*pagos:\s*\{[^\n]*\n/m, "");

    const conPagos = declaracionesConst(real).filter(
      (d) => /\bmetodoPago:\s*true\b/.test(d.cuerpo) && !/\bpagos:\s*\{/.test(d.cuerpo),
    );
    const sinPagos = declaracionesConst(mutado).filter(
      (d) => /\bmetodoPago:\s*true\b/.test(d.cuerpo) && !/\bpagos:\s*\{/.test(d.cuerpo),
    );

    expect(conPagos).toHaveLength(0);
    expect(sinPagos.map((d) => d.nombre)).toEqual(["GESTION_ADMIN_SELECT"]);
  });
});

describe("R23 — el tercer camino (bodega) REUSA la proyección de admin, no una copia", () => {
  const BODEGA = "lib/repositories/CierresBodegaAdminRepository.ts";

  it("importa `GESTION_ADMIN_SELECT` y `toPendienteRowDesdeSnapshot` de `CierresAdminRepository`", () => {
    const codigo = codigoSinComentarios(BODEGA);

    expect(codigo).toMatch(
      /import\s*\{[^}]*\bGESTION_ADMIN_SELECT\b[^}]*\}\s*from\s*"@\/lib\/repositories\/CierresAdminRepository"/,
    );
    expect(codigo).toMatch(
      /import\s*\{[^}]*\btoPendienteRowDesdeSnapshot\b[^}]*\}\s*from\s*"@\/lib\/repositories\/CierresAdminRepository"/,
    );
    // Y las USA: importarlas y no usarlas sería el mismo agujero con mejor cara.
    expect(codigo).toMatch(/select:\s*GESTION_ADMIN_SELECT/);
    expect(codigo).toMatch(/toPendienteRowDesdeSnapshot\s*\(/);
  });

  it("y NO declara una proyección propia de la gestión (que podría nacer sin `pagos`)", () => {
    // Éste es el fallo que el requisito persigue de verdad: no que la copia esté mal escrita
    // hoy, sino que exista. Una copia nace igual a la original y diverge después, y el día que
    // diverja el detalle de bodega dará totales en cero sin que se mueva nada de admin.
    const codigo = codigoSinComentarios(BODEGA);
    const propias = declaracionesConst(codigo).filter((d) =>
      /\bmetodoPago:\s*true\b|\bmontoRecibido:\s*true\b/.test(d.cuerpo),
    );

    expect(propias.map((d) => d.nombre)).toEqual([]);

    // Control de no-vacuidad: el archivo SÍ declara proyecciones (las suyas, del cierre), así
    // que el `toEqual([])` de arriba no está pasando por leer un archivo vacío.
    expect(declaracionesConst(codigo).length).toBeGreaterThan(0);
  });

  it("CONTROL DE NO-VACUIDAD: los tres archivos de los tres caminos existen vivos", () => {
    for (const ruta of [
      "lib/repositories/CierreDiaRepository.ts",
      "lib/repositories/CierresAdminRepository.ts",
      BODEGA,
    ]) {
      expect(readFileSync(path.join(RAIZ, ruta), "utf8").length, `${ruta} vacío`).toBeGreaterThan(
        1000,
      );
    }
  });
});
