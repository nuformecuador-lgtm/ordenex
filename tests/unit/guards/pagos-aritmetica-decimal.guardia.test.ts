import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { computeTotales } from "@/lib/utils/cierre-totales";
import { aCentimos, sumaCuadra } from "@/lib/utils/pagos-recaudo";
import { toLineasPago } from "@/lib/utils/lineas-pago";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
import { Prisma } from "@prisma/client";
import { codigoSinComentarios, quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 212 / T15 (R30) — GUARDIA DE ARITMÉTICA: **en los caminos que esta feature toca, un
 * monto no se convierte a `number` ni se suma en coma flotante.**
 *
 * Por qué en un archivo aparte y por qué es de las que corren siempre. La batería de
 * `cierre-totales-pagos.test.ts` mide RESULTADOS: si alguien cambia la suma a floats, los casos
 * con decimales la ponen roja. Pero un float solo se delata con los montos adecuados, y un
 * refactor futuro puede introducirlo en un tramo que ningún caso ejercita todavía. Esto de aquí
 * mide la FORMA: no hay `parseFloat`, no hay `Number(`, la suma es `Prisma.Decimal` y la
 * serialización sale por `toFixed(2)`. Las dos cosas juntas son la red; ninguna sola basta.
 *
 * Y por qué importa tanto: `cierre_dia.total_efectivo` es la `E` del `min(P, E)` del pago al
 * mensajero (feature 44). Un céntimo perdido aquí no es un número feo en pantalla, es dinero mal
 * pagado a una persona.
 *
 * El barrido va sobre el CÓDIGO, no sobre el texto crudo: los docstrings de este árbol citan a
 * propósito lo prohibido («cero `parseFloat`», «nunca number/parseFloat»), y un barrido literal
 * fallaría por CITARLO. La contraprueba del final mide las dos direcciones.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Las tres formas de perder un céntimo convirtiendo. `toFixed` va aparte: tiene matiz. */
const CONVERSIONES_PROHIBIDAS: readonly RegExp[] = [
  /\bNumber\s*\(/,
  /\bparseFloat\s*\(/,
  /\bparseInt\s*\(/,
  /\.toNumber\s*\(/,
];

/**
 * Extrae el bloque que empieza en `marcador`, balanceando llaves. Se usa para acotar el barrido
 * al TRAMO NUEVO de un archivo que también tiene código anterior a esta feature.
 */
function bloqueDesde(codigo: string, marcador: string): string {
  const i = codigo.indexOf(marcador);
  if (i < 0) throw new Error(`no se encontró el marcador \`${marcador}\``);
  const inicio = codigo.indexOf("{", i);
  if (inicio < 0) throw new Error(`el marcador \`${marcador}\` no abre bloque`);
  let profundidad = 0;
  for (let j = inicio; j < codigo.length; j += 1) {
    if (codigo[j] === "{") profundidad += 1;
    else if (codigo[j] === "}") {
      profundidad -= 1;
      if (profundidad === 0) return codigo.slice(i, j + 1);
    }
  }
  throw new Error(`el bloque de \`${marcador}\` no cierra`);
}

/**
 * Los CINCO tramos que R30 vigila. R30 nombra tres caminos: el **cálculo de totales**, la
 * **persistencia de líneas** y la **revalidación del servicio**; este censo los cubre los tres.
 *
 * Los tres utils entran ENTEROS: son de esta feature de punta a punta. El repositorio y el
 * servicio entran ACOTADOS al tramo nuevo, y no por comodidad:
 *  · `GestionOrdenRepository.ts` trae `.toNumber()` anteriores a la 212 sobre `peso`, `latitud`,
 *    `longitud` y `montoCobrar` (`:137-142`, `:226`, `:248`);
 *  · `MisAsignacionesService.ts` trae la suma de KPIs de la barra del mensajero
 *    (`porGestionar.reduce((sum, o) => sum + (o.montoCobrar ?? 0), 0)`, `:223`/`:232`), que suma
 *    montos con el operador `+` sobre `number` y es anterior a esta feature.
 * Los dos son deuda de otras features. Barrer los archivos enteros pondría esta guardia roja por
 * código que la 212 ni escribió ni puede arreglar — y una guardia que nace roja por algo ajeno se
 * acaba desactivando. Se vigila lo que esta feature introdujo.
 *
 * El tramo del servicio empieza en el `reduce` de R18 y llega hasta el `return` del rechazo: es
 * EXACTAMENTE la segunda barrera, la que decide si el desglose cuadra antes de persistir.
 */
const MARCADOR_SERVICIO = "const sumaPagos = input.pagos.reduce";

const TRAMOS: { nombre: string; codigo: string }[] = (() => {
  const utils = [
    "lib/utils/cierre-totales.ts",
    "lib/utils/pagos-recaudo.ts",
    "lib/utils/lineas-pago.ts",
  ].map((ruta) => ({ nombre: ruta, codigo: codigoSinComentarios(ruta) }));

  const repo = codigoSinComentarios("lib/repositories/GestionOrdenRepository.ts");
  const servicio = codigoSinComentarios("lib/services/MisAsignacionesService.ts");
  return [
    ...utils,
    {
      nombre: "lib/repositories/GestionOrdenRepository.ts (tramo del desglose)",
      codigo: bloqueDesde(repo, "if (gestion.pagos"),
    },
    {
      nombre: "lib/services/MisAsignacionesService.ts (revalidación de la suma, R18)",
      codigo: bloqueDesde(servicio, MARCADOR_SERVICIO),
    },
  ];
})();

/** Fila mínima de cierre con el desglose que se le pase. Solo importa lo que suma. */
function gestion(
  pagos: CierreGestionPendienteRow["pagos"],
  resultado: CierreGestionPendienteRow["resultado"] = "entregada",
): CierreGestionPendienteRow {
  return {
    gestionId: `g-${pagos.map((p) => p.metodo).join("-")}-${resultado}`,
    ordenId: "o-1",
    numGuia: 1,
    numRemision: "R-1",
    destinatario: "D",
    direccion: "Dir",
    zonaNombre: "Z",
    provinciaNombre: "P",
    cantonNombre: "C",
    distritoNombre: null,
    producto: "Producto",
    tiendaNombre: "T",
    resultado,
    montoRecibido: null,
    metodoPago: null,
    pagos,
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: null,
    pagoMensajero: null,
    ingresoBodegaRechazo: null,
    esRechazoSla: false,
    desdeAyudaTienda: false, // feature 237 (D6/R41): la registro el mensajero, no la tienda
    causaIncidente: null,
    indemnizacion: null,
  };
}

describe("R30 — ningún tramo del recaudo convierte un monto a número", () => {
  it("CONTROL DE NO-VACUIDAD: los cinco tramos existen, tienen contenido y son los suyos", () => {
    // Sin esto, las prohibiciones de abajo podrían estar pasando sobre cadenas vacías (por un
    // archivo movido o por un marcador que dejó de casar) y nadie se enteraría.
    expect(TRAMOS).toHaveLength(5);
    for (const tramo of TRAMOS) {
      expect(tramo.codigo.length, `${tramo.nombre} está vacío`).toBeGreaterThan(120);
    }
    expect(TRAMOS[0].codigo).toContain("export function computeTotales");
    expect(TRAMOS[1].codigo).toContain("export function normalizarPagos");
    expect(TRAMOS[2].codigo).toContain("export function toLineasPago");
    expect(TRAMOS[3].codigo).toContain("tx.gestionOrdenPago.createMany");
    // El tramo del servicio es la revalidación completa: la suma Y el rechazo que la usa.
    expect(TRAMOS[4].codigo).toContain("new Prisma.Decimal(p.monto)");
    expect(TRAMOS[4].codigo).toContain("sumaPagos.equals(");
    expect(TRAMOS[4].codigo).toContain('status: "validation_error"');
  });

  it("ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toNumber()` en ninguno de los cinco", () => {
    const hallazgos: string[] = [];
    for (const tramo of TRAMOS) {
      for (const patron of CONVERSIONES_PROHIBIDAS) {
        const encontrado = tramo.codigo.match(patron);
        if (encontrado) hallazgos.push(`${tramo.nombre}: ${encontrado[0]}`);
      }
    }
    expect(hallazgos, "conversión de un monto a número en el camino del recaudo").toEqual([]);
  });

  it("todo `toFixed` de estos tramos es de escala 2: es el serializador, no un redondeo", () => {
    // `toFixed` NO está prohibido en el servidor y prohibirlo no protegería nada: sobre un
    // `Prisma.Decimal` es la serialización EXACTA a STRING de escala 2, que es el formato en el
    // que el dinero cruza la frontera. Lo que sí importa es que SIEMPRE lleve los dos decimales:
    // un `toFixed()` pelado —o con otro argumento— emite un string que la frontera no acepta.
    const malos: string[] = [];
    for (const tramo of TRAMOS) {
      for (const uso of tramo.codigo.matchAll(/\.toFixed\(([^)]*)\)/g)) {
        if (uso[1].trim() !== "2") malos.push(`${tramo.nombre}: .toFixed(${uso[1]})`);
      }
    }
    expect(malos).toEqual([]);
  });

  it("la serialización del desglose sale de UN solo sitio, y los dos lectores lo usan", () => {
    // Dos copias del `Decimal -> string` serían dos oportunidades de serializar con otra escala
    // en un camino money-critical. `toLineasPago` es el único punto donde eso ocurre, y las dos
    // proyecciones que producen la fila pasan por él en vez de mapear a mano.
    for (const ruta of [
      "lib/repositories/CierreDiaRepository.ts",
      "lib/repositories/CierresAdminRepository.ts",
    ]) {
      const codigo = codigoSinComentarios(ruta);
      expect(codigo, `${ruta} no importa el serializador`).toContain(
        'from "@/lib/utils/lineas-pago"',
      );
      expect(codigo, `${ruta} no serializa el desglose con el helper`).toMatch(
        /pagos:\s*toLineasPago\(/,
      );
    }
  });
});

describe("R30 — la suma va en `Prisma.Decimal` (y en el borde, en céntimos enteros)", () => {
  it("`computeTotales` acumula con `Decimal.plus` y no con el operador `+`", () => {
    const cuerpo = bloqueDesde(
      codigoSinComentarios("lib/utils/cierre-totales.ts"),
      "export function computeTotales",
    );

    expect(cuerpo).toContain("new Prisma.Decimal(");
    expect(cuerpo).toContain(".plus(");
    // Ni un `+` en todo el cuerpo. Es la forma más directa de decir «aquí no se suma con el
    // operador»: en cuanto alguien escriba `efectivo + monto` o un `+=`, esto cae.
    expect(cuerpo.includes("+"), "`computeTotales` usa el operador `+` sobre montos").toBe(false);
  });

  it("MEDIDO: la exactitud decimal que un float no daría (33.33 × 3 repartido en dos métodos)", () => {
    // El control de no-vacuidad de todo lo anterior: la forma sin el resultado no prueba nada.
    // 33.33 tres veces es el caso 8 del design §4; en floats, `33.33 + 33.33 + 33.33` da
    // `99.99000000000001` y el string saldría mal.
    const totales = computeTotales([
      gestion([
        { metodo: "efectivo", monto: "33.33" },
        { metodo: "SINPE", monto: "33.33" },
      ]),
      gestion([{ metodo: "transferencia", monto: "33.33" }]),
    ]);

    expect(totales).toEqual({
      efectivo: "33.33",
      simpe: "33.33",
      transferencia: "33.33",
      general: "99.99",
    });
    // Y el `0.1 + 0.2` de manual, que en coma flotante es `0.30000000000000004`.
    expect(
      computeTotales([
        gestion([
          { metodo: "efectivo", monto: "0.10" },
          { metodo: "SINPE", monto: "0.20" },
        ]),
      ]).general,
    ).toBe("0.30");
  });

  it("el util PURO del borde NO importa `@prisma/client` (viaja al bundle del navegador)", () => {
    // `lib/types/gestion-orden.ts` valida el desglose en el borde y el panel lo importa TAMBIÉN
    // en cliente (`GestionarOrdenPanel.tsx` hace `safeParse` con el mismo schema). Si este util
    // arrastrara `@prisma/client`, el bundle del navegador se llevaría el runtime de Prisma. Por
    // eso su aritmética es en céntimos ENTEROS y no en `Decimal`: la frontera de `Decimal`
    // empieza donde ya empezaba —el servicio (R18) y el repositorio (R20)—.
    const codigo = codigoSinComentarios("lib/utils/pagos-recaudo.ts");

    expect(codigo).not.toMatch(/from\s+"(@prisma\/client|decimal\.js[^"]*)"/);
    expect(codigo).not.toMatch(/\bnew\s+(Prisma\.)?Decimal\s*\(/);
    // Y lo hace con enteros: `Math.round(v * 100)` es la única multiplicación que ve un float.
    expect(codigo).toContain("Math.round(");

    // Contracara: quien SÍ puede (y debe) usar `Decimal` es el lado servidor.
    expect(codigoSinComentarios("lib/utils/cierre-totales.ts")).toContain(
      'from "@prisma/client"',
    );
  });

  it("MEDIDO: la suma del borde cuadra en casos donde una suma float NO cuadraría", () => {
    // `0.1 + 0.2 !== 0.3` en coma flotante: con una suma de floats, esta primera aserción sería
    // roja. En céntimos enteros, `10 + 20 === 30`, exacto.
    expect(sumaCuadra([{ monto: 0.1 }, { monto: 0.2 }], 0.3)).toBe(true);
    expect(sumaCuadra([{ monto: 5000.1 }, { monto: 2999.9 }], 8000)).toBe(true);
    // Y sigue distinguiendo: un céntimo de más NO cuadra.
    expect(sumaCuadra([{ monto: 5000.11 }, { monto: 2999.9 }], 8000)).toBe(false);
    // El float que llega del borde puede venir con la basura de la representación; redondear a
    // céntimos la absorbe, truncar perdería el centavo.
    expect(aCentimos(8000.000000000001)).toBe(800000);
    expect(aCentimos(0.29999999999999998)).toBe(30);
  });

  it("MEDIDO: el serializador emite escala 2 fija desde `Decimal`, sin pasar por `number`", () => {
    expect(
      toLineasPago([
        { metodo: "efectivo", monto: new Prisma.Decimal("5000") },
        { metodo: "transferencia", monto: new Prisma.Decimal("3000.5") },
      ]),
    ).toEqual([
      { metodo: "efectivo", monto: "5000.00" },
      { metodo: "transferencia", monto: "3000.50" },
    ]);
  });
});

describe("R30 — el tramo del repositorio persiste `Decimal`, no floats", () => {
  it("el `createMany` del desglose construye cada monto como `Prisma.Decimal`", () => {
    const tramo = TRAMOS[3].codigo;

    expect(tramo).toContain("tx.gestionOrdenPago.createMany");
    expect(tramo).toMatch(/monto:\s*new Prisma\.Decimal\(/);
    // Lo que NO puede hacer: pasar el `number` que llega del borde tal cual.
    expect(tramo).not.toMatch(/monto:\s*p\.monto\b/);
  });
});

describe("R30 — la REVALIDACIÓN del servicio suma en `Decimal`, no en coma flotante", () => {
  it("la segunda barrera (R18) acumula con `Decimal.plus` y compara con `equals`", () => {
    const tramo = TRAMOS[4].codigo;

    expect(tramo).toMatch(/new Prisma\.Decimal\(p\.monto\)/);
    expect(tramo).toContain(".plus(");
    expect(tramo).toMatch(/sumaPagos\.equals\(new Prisma\.Decimal\(input\.montoRecibido\)\)/);
    // Ni un `+` en el tramo. Es la forma más directa de decir «aquí no se suma con el operador»:
    // en cuanto alguien escriba `acc + p.monto` o un `+=`, esto cae. Y es también la razón de que
    // el tramo vaya ACOTADO: el mismo archivo suma los KPIs de la barra con `+` sobre `number`
    // (código anterior a la 212), y prohibirlo ahí sería prohibir lo que esta feature no tocó.
    expect(tramo.includes("+"), "la revalidación usa el operador `+` sobre montos").toBe(false);
    // Y la comparación NO se hace convirtiendo: `.equals` sobre `Decimal`, nunca `===` entre
    // números, que es exactamente donde `0.1 + 0.2 !== 0.3` rechazaría un desglose legítimo.
    expect(tramo).not.toMatch(/===|!==/);
  });

  it("el extractor no se lleva el archivo entero: la asimetría del `+` lo mide", () => {
    // Si `bloqueDesde` devolviera de más, el tramo arrastraría la suma de KPIs con `+` y la
    // aserción de arriba sería roja por deuda ajena; si devolviera de menos, no vigilaría nada.
    const completo = codigoSinComentarios("lib/services/MisAsignacionesService.ts");
    const tramo = TRAMOS[4].codigo;

    expect(completo).toContain(tramo);
    expect(tramo.length).toBeLessThan(completo.length / 10);
    expect(tramo.length).toBeGreaterThan(120);
    // El archivo completo SÍ suma montos con `+` (`sum + (o.montoCobrar ?? 0)`, la barra de KPIs
    // del mensajero, anterior a esta feature); el tramo, no.
    expect(completo).toMatch(/sum \+ \(o\.montoCobrar/);
    expect(tramo).not.toMatch(/montoCobrar/);
  });
});

describe("CONTRAPRUEBA — el barrido caza lo colado y no caza la cita", () => {
  it("una conversión inyectada se encuentra; el mismo texto en un comentario, no", () => {
    const colado = "const total = Number(monto) + parseFloat(otro);\n";
    const citado = "// money-safe: aquí no se usa Number( ni parseFloat(\nconst m = p.monto;\n";

    const cazadas = (fuente: string) =>
      CONVERSIONES_PROHIBIDAS.filter((p) => p.test(quitarComentarios(fuente))).length;

    expect(cazadas(colado)).toBe(2);
    expect(cazadas(citado)).toBe(0);

    // Y sobre los archivos REALES: hoy no cazan nada, y con la llamada inyectada sí.
    for (const tramo of TRAMOS) {
      expect(cazadas(tramo.codigo), `${tramo.nombre} ya trae una conversión`).toBe(0);
      expect(cazadas(`${tramo.codigo}\nconst x = parseFloat(p.monto);`)).toBe(1);
    }
  });

  it("el extractor de bloques no devuelve el archivo entero por accidente", () => {
    // Si `bloqueDesde` fallara devolviendo todo el fuente, el tramo del repositorio arrastraría
    // los `.toNumber()` ajenos y esta guardia sería roja por deuda de otra feature; si devolviera
    // de menos, no vigilaría nada. Se fija por los dos lados.
    const completo = codigoSinComentarios("lib/repositories/GestionOrdenRepository.ts");
    const tramo = TRAMOS[3].codigo;

    expect(tramo.length).toBeLessThan(completo.length / 10);
    expect(tramo.length).toBeGreaterThan(120);
    expect(completo).toContain(tramo);
    // El archivo completo SÍ trae conversiones anteriores a la 212; el tramo, no. Si el
    // extractor devolviera de más, esta asimetría desaparecería.
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.test(completo))).toBe(true);
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.test(tramo))).toBe(false);
  });

  it("CONTROL: los archivos vigilados están donde dice el censo", () => {
    for (const ruta of [
      "lib/utils/cierre-totales.ts",
      "lib/utils/pagos-recaudo.ts",
      "lib/utils/lineas-pago.ts",
      "lib/repositories/GestionOrdenRepository.ts",
      "lib/services/MisAsignacionesService.ts",
    ]) {
      expect(readFileSync(path.join(RAIZ, ruta), "utf8").length, `${ruta} vacío`).toBeGreaterThan(
        200,
      );
    }
  });
});
