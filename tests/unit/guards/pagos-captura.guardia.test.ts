import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { gestionarSchema } from "@/lib/types/gestion-orden";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";
import { LLAMADAS_PROHIBIDAS_EN_DINERO } from "../../fixtures/money-safe";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 213 / T13 — GUARDIA DE LA CAPTURA. Cuatro propiedades DURADERAS del frontend del
 * pago múltiple, cada una con CONTRAPRUEBA y con control de NO-VACUIDAD:
 *
 *  - R19: lo que el panel del mensajero arrastra al BUNDLE DEL NAVEGADOR.
 *  - R23: los tres sitios de presentación derivan del DESGLOSE, no del escalar.
 *  - R11/R31: ni la captura ni las descargas hacen aritmética de coma flotante con dinero.
 *  - R32: la forma escalar del BORDE sigue viva (su retiro es la ficha 214, no ésta).
 *
 * Ninguna de las cuatro se mide sobre el diff: un test de diff da vacío —y por tanto verde—
 * el día después del merge, y peor, pasa a juzgar cualquier rama posterior. Se miden sobre el
 * ÁRBOL, y las listas de archivos se DESCUBREN (del grafo de imports) allí donde se puede
 * descubrirlas, en vez de escribirse a mano y envejecer en silencio.
 */

const RAIZ = path.resolve(__dirname, "../../..");

function fuente(ruta: string): string {
  return readFileSync(path.join(RAIZ, ruta), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R19 — el árbol de imports del panel no arrastra runtime de servidor
// ─────────────────────────────────────────────────────────────────────────────────────────────

const PANEL = "app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx";

/**
 * El módulo que R19 prohíbe POR SU NOMBRE: es el serializador de las PROYECCIONES Prisma del
 * servidor (`Prisma.GestionOrdenGetPayload`), no el util del borde. MEDIDO hoy: sus imports de
 * `@prisma/client` son de tipo, así que la prohibición no se apoya en el bundle sino en el ROL —
 * un componente de cliente que lo importase estaría leyendo la forma de una consulta de Prisma,
 * y el día que ese módulo necesite un valor el bundle se lo llevaría sin avisar. El util que sí
 * sirve en el cliente es `lib/utils/pagos-recaudo.ts`.
 */
const LINEAS_PAGO = "lib/utils/lineas-pago";

const EXTENSIONES = [".ts", ".tsx", ".d.ts"];

/**
 * Resuelve un especificador a una ruta del repo.
 *   `null`      → paquete externo (`react`, `@prisma/client`, …): no se recorre, se AUDITA aparte.
 *   `undefined` → especificador interno que NO resuelve: es un agujero del barrido y se denuncia.
 */
function resolver(especificador: string, desde: string): string | null | undefined {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(RAIZ, especificador.slice(2));
  else if (especificador.startsWith(".")) {
    base = path.resolve(path.dirname(path.join(RAIZ, desde)), especificador);
  } else return null;

  const candidatos = [
    ...EXTENSIONES.map((e) => base + e),
    ...EXTENSIONES.map((e) => path.join(base, `index${e}`)),
  ];
  for (const candidato of candidatos) {
    if (existsSync(candidato) && statSync(candidato).isFile()) {
      return path.relative(RAIZ, candidato).split(path.sep).join("/");
    }
  }
  return undefined;
}

/**
 * `import … from "x"`, `export … from "x"` e `import("x")`. Se aplica sobre el fuente SIN
 * comentarios: este árbol EXPLICA por escrito lo que tiene prohibido importar
 * («NO importa `@prisma/client`»), y un barrido sobre el texto crudo denunciaría la explicación.
 */
const RE_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

interface Arbol {
  /** Rutas del repo alcanzables desde la raíz, la propia raíz incluida. */
  readonly archivos: string[];
  /** Fuente ya sin comentarios de cada archivo del árbol. */
  readonly codigo: Map<string, string>;
  /** Módulos `"use server"` donde el recorrido se DETIENE (ver nota abajo). */
  readonly frontera: string[];
  /** Especificadores internos que no resolvieron: si hay alguno, el barrido mira de menos. */
  readonly noResueltos: string[];
}

/**
 * Recorrido TRANSITIVO desde un archivo raíz.
 *
 * `sustituciones` permite inyectar un fuente EN MEMORIA para las contrapruebas: el archivo real
 * del repo no se toca nunca (un test que muta el árbol de trabajo es un test que puede dejarlo
 * roto).
 *
 * **El recorrido se DETIENE en los módulos `"use server"`, y es una decisión, no un descuido:**
 * un fichero de Server Actions NO viaja al bundle. Next lo sustituye por una referencia y sus
 * imports —`getPrismaClient`, repositorios, servicios— se quedan enteros del lado del servidor.
 * Seguir a través de ellos convertiría este guardia en «el panel alcanza Prisma», que es cierto
 * y no dice nada. Lo que se afirma aquí es lo que el NAVEGADOR se descarga.
 */
function arbolDesde(raiz: string, sustituciones: Record<string, string> = {}): Arbol {
  const vistos = new Set<string>();
  const codigo = new Map<string, string>();
  const frontera: string[] = [];
  const noResueltos: string[] = [];
  const pendientes = [raiz];

  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    if (vistos.has(actual)) continue;
    vistos.add(actual);

    const texto = sustituciones[actual] ?? fuente(actual);
    const sinComentarios = quitarComentarios(texto);
    codigo.set(actual, sinComentarios);

    if (/^\s*["']use server["']/.test(sinComentarios)) {
      frontera.push(actual);
      continue;
    }

    for (const m of sinComentarios.matchAll(RE_IMPORT)) {
      const especificador = m[1] ?? m[2];
      const destino = resolver(especificador, actual);
      if (destino === null) continue;
      if (destino === undefined) {
        noResueltos.push(`${actual} -> ${especificador}`);
        continue;
      }
      pendientes.push(destino);
    }
  }

  return { archivos: [...vistos].sort(), codigo, frontera, noResueltos };
}

/**
 * Los archivos del árbol que ALCANZAN el serializador del servidor: el propio módulo si es
 * alcanzable (la infracción de verdad) y cualquiera que lo nombre (por si un día se llega a él
 * por un camino que este resolvedor no siga, como un `require` o un alias nuevo).
 */
function alcanzanLineasPago(arbol: Arbol): string[] {
  return [...arbol.codigo]
    .filter(([ruta, codigo]) => ruta.startsWith(LINEAS_PAGO) || codigo.includes(LINEAS_PAGO))
    .map(([ruta]) => ruta)
    .sort();
}

/** Las sentencias de import de `@prisma/client` de un fuente, tal cual. */
function importsDePrisma(codigo: string): string[] {
  return [...codigo.matchAll(/(?:^|\n)\s*(import[^;]*?from\s*["']@prisma\/client["'])/g)].map(
    (m) => m[1].replace(/\s+/g, " ").trim(),
  );
}

/**
 * DECISIÓN EXPLÍCITA sobre `import type` (la pregunta que R19 deja abierta).
 *
 * Un `import type { X } from "@prisma/client"` **se BORRA al compilar**: TypeScript emite el
 * módulo sin esa sentencia, así que no crea `require`, no entra en el grafo del bundler y NO
 * viaja al navegador. Prohibirlo obligaría a duplicar los tipos del enum en el cliente, que es
 * la forma segura de que un día dejen de coincidir con la base.
 *
 * **Se TOLERA el `import type` y se prohíbe TODA importación de VALOR.** Y no se afirma «no hay
 * `@prisma/client`» —sería falso, hay catorce—: se afirma que TODAS son de tipo. Lo que viaja
 * es el valor; el tipo es una anotación que el compilador se lleva.
 *
 * `import { type X }` (especificador de tipo en línea) cuenta igual: también se borra.
 */
function esImportSoloDeTipo(sentencia: string): boolean {
  if (/^import\s+type\b/.test(sentencia)) return true;
  const llaves = sentencia.match(/\{([^}]*)\}/);
  if (!llaves) return false; // `import Prisma from …` / `import * as Prisma from …`: VALOR.
  if (/^import\s*\{/.test(sentencia) === false) return false; // hay default además de las llaves.
  const especificadores = llaves[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return especificadores.length > 0 && especificadores.every((s) => /^type\s/.test(s));
}

const ARBOL_DEL_PANEL = arbolDesde(PANEL);

describe("R19 — el bundle del panel no arrastra runtime de servidor", () => {
  it("CONTROL DE NO-VACUIDAD: el recorrido es TRANSITIVO y no deja agujeros", () => {
    // Sin esto, un `not.toContain` sobre un árbol de un solo archivo —o de cero— pasaría igual.
    expect(ARBOL_DEL_PANEL.archivos, "el árbol se quedó en el archivo suelto").length.greaterThan(
      30,
    );
    expect(ARBOL_DEL_PANEL.archivos).toContain(PANEL);
    // Vecinos a distancia 1 y a distancia 2: prueba que se está siguiendo el grafo de verdad.
    expect(ARBOL_DEL_PANEL.archivos).toContain(
      "app/(app)/mis-asignaciones/_components/desglose-captura.ts",
    );
    expect(ARBOL_DEL_PANEL.archivos).toContain(
      "app/(app)/cierres-admin/_components/cierre-labels.ts", // llega vía `desglose-captura`
    );
    // Un especificador interno que no resuelve es una rama del árbol que el barrido NO miró.
    expect(ARBOL_DEL_PANEL.noResueltos, "hay imports internos sin resolver").toEqual([]);
  });

  it("MEDIDO: el recorrido se detiene en los Server Actions, y solo en ellos", () => {
    expect(ARBOL_DEL_PANEL.frontera.length, "el panel ya no llama a ninguna Server Action")
      .toBeGreaterThan(0);
    for (const ruta of ARBOL_DEL_PANEL.frontera) {
      expect(ruta, `${ruta} se cortó sin ser un módulo de acciones`).toMatch(/^lib\/actions\//);
      expect(quitarComentarios(fuente(ruta))).toMatch(/^\s*["']use server["']/);
    }
  });

  it("ningún módulo del árbol importa `@prisma/client` como VALOR", () => {
    const deValor: string[] = [];
    const deTipo: string[] = [];
    for (const [ruta, codigo] of ARBOL_DEL_PANEL.codigo) {
      for (const sentencia of importsDePrisma(codigo)) {
        (esImportSoloDeTipo(sentencia) ? deTipo : deValor).push(`${ruta}: ${sentencia}`);
      }
    }

    expect(deValor, "el bundle del navegador arrastraría el cliente de Prisma").toEqual([]);
    // NO-VACUIDAD de la decisión: si algún día no quedara ni un `import type`, la distinción
    // «tipo sí, valor no» habría dejado de estar puesta a prueba y este caso sería decorado.
    expect(deTipo.length, "no queda ningún `import type` que distinguir del valor").toBeGreaterThan(
      5,
    );
  });

  it("ningún módulo del árbol nombra `lib/utils/lineas-pago`", () => {
    expect(alcanzanLineasPago(ARBOL_DEL_PANEL)).toEqual([]);
    expect(ARBOL_DEL_PANEL.archivos, "el árbol perdió el util puro de la 212").toContain(
      "lib/utils/pagos-recaudo.ts",
    );
  });

  it("CONTRAPRUEBA: un import inyectado en el panel pone el barrido en rojo", () => {
    // El archivo real NO se toca: la mutación vive en memoria y solo dentro de este caso.
    const mutado = fuente(PANEL).replace(
      'import { Button } from "@/components/ui/button";',
      [
        'import { Prisma } from "@prisma/client";',
        'import { lineasDeGestion } from "@/lib/utils/lineas-pago";',
        'import { Button } from "@/components/ui/button";',
      ].join("\n"),
    );
    expect(mutado, "la mutación no se aplicó: el ancla del `replace` ya no existe").not.toEqual(
      fuente(PANEL),
    );

    const sucio = arbolDesde(PANEL, { [PANEL]: mutado });

    const valoresDePrisma = [...sucio.codigo].flatMap(([ruta, codigo]) =>
      importsDePrisma(codigo)
        .filter((s) => !esImportSoloDeTipo(s))
        .map((s) => `${ruta}: ${s}`),
    );
    // El import de VALOR del panel, que en el árbol limpio no existe en ningún módulo.
    expect(valoresDePrisma.map((s) => s.split(":")[0])).toEqual([PANEL]);
    // Y el serializador del servidor, alcanzado por el panel y ahora dentro del árbol.
    expect(alcanzanLineasPago(sucio)).toEqual([PANEL, "lib/utils/lineas-pago.ts"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R23 — los tres sitios de presentación derivan del DESGLOSE, no del escalar
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los tres sitios, cada uno con el ANCLA que prueba que se está leyendo el archivo que se cree
 * (y no uno vacío, movido o renombrado). El ancla es además la afirmación POSITIVA de R23: no
 * basta con que no lean el escalar, tienen que leer el desglose.
 */
const SITIOS_DE_PRESENTACION: { ruta: string; ancla: string }[] = [
  { ruta: "app/(app)/cierre-dia/_components/CierreDiaModule.tsx", ancla: "desglosePantalla" },
  { ruta: "app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx", ancla: "desglosePantalla" },
  { ruta: "app/(app)/cierres-admin/_components/cierre-factura.tsx", ancla: "desglosePantalla" },
];

/** El campo escalar de la gestión: el que R23 saca de la presentación (y R32 mantiene vivo). */
const CAMPO_ESCALAR = "metodoPago";

describe("R23 — la presentación no lee `metodoPago` de la gestión", () => {
  it("CONTROL DE NO-VACUIDAD: los tres existen, tienen cuerpo y pintan el desglose", () => {
    for (const { ruta, ancla } of SITIOS_DE_PRESENTACION) {
      const texto = fuente(ruta);
      expect(texto.length, `${ruta} está vacío`).toBeGreaterThan(1000);
      expect(texto, `${ruta} ya no llama a \`${ancla}\``).toContain(ancla);
    }
  });

  for (const { ruta } of SITIOS_DE_PRESENTACION) {
    it(`\`${ruta}\` no nombra \`${CAMPO_ESCALAR}\``, () => {
      // Sin comentarios: estos archivos pueden EXPLICAR que ya no leen el escalar.
      expect(quitarComentarios(fuente(ruta))).not.toContain(CAMPO_ESCALAR);
    });
  }

  it("CONTRAPRUEBA: una lectura del escalar inyectada se caza en los tres", () => {
    for (const { ruta } of SITIOS_DE_PRESENTACION) {
      const real = quitarComentarios(fuente(ruta));
      const mutado = `${real}\nconst metodo = g.${CAMPO_ESCALAR} ?? "—";`;

      expect(real.includes(CAMPO_ESCALAR)).toBe(false);
      expect(mutado.includes(CAMPO_ESCALAR)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R11 / R31 — dinero sin coma flotante y sin moneda incrustada
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MODULO_DE_CAPTURA = "app/(app)/mis-asignaciones/_components/desglose-captura.ts";
const MODULOS_DE_DESCARGA = [
  "app/(app)/cierre-dia/_components/cierre-dia-descarga-columnas.ts",
  "app/(app)/cierres-admin/_components/cierre-gestiones-descarga-columnas.ts",
];

/**
 * Un símbolo de moneda ESCRITO EN EL CÓDIGO. `docs/architecture.md` lo prohíbe: la moneda sale
 * de configuración (`money()`), y un `₡` incrustado es una app que solo funciona en un país.
 * El `$` se persigue salvo cuando abre una interpolación (`${…}`), que no es dinero.
 */
const SIMBOLO_DE_MONEDA = /[₡€£¥]|\$(?!\{)/;

/** Las llamadas prohibidas, con posición, para poder decir SI CAEN DENTRO de la excepción. */
function llamadasProhibidas(codigo: string): { llamada: string; indice: number }[] {
  const salida: { llamada: string; indice: number }[] = [];
  for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
    for (const m of codigo.matchAll(new RegExp(patron.source, "g"))) {
      salida.push({ llamada: m[0], indice: m.index! });
    }
  }
  return salida.sort((a, b) => a.indice - b.indice);
}

/** El cuerpo de una función, por emparejamiento de llaves desde su declaración. */
function rangoDeFuncion(codigo: string, nombre: string): { desde: number; hasta: number } {
  const desde = codigo.indexOf(`function ${nombre}(`);
  expect(desde, `\`${nombre}\` ya no existe en el módulo`).toBeGreaterThanOrEqual(0);
  let i = codigo.indexOf("{", desde);
  let profundidad = 0;
  for (; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}" && --profundidad === 0) return { desde, hasta: i + 1 };
  }
  throw new Error(`no se pudo cerrar el cuerpo de ${nombre}`);
}

/**
 * LA ÚNICA EXCEPCIÓN ADMITIDA, y por qué NO es un permiso general:
 *
 * `montoDeTexto` es la conversión del input del PROPIO campo de monto. El `<input>` devuelve un
 * `string` y alguien tiene que interpretarlo una vez, en la frontera. Todo lo que viene después
 * —sumar, restar, comparar contra el total— se hace en CÉNTIMOS ENTEROS con `aCentimos` /
 * `sumaCuadra` de la 212. La excepción se acota por POSICIÓN (dentro del cuerpo de esa función)
 * y no por nombre de archivo: un `parseFloat` en cualquier otra línea del mismo módulo sigue
 * siendo una infracción. Y `montoDeTexto` NO se exporta, así que la excepción tampoco puede
 * viajar a otro módulo.
 */
const EXCEPCION_ACOTADA = "montoDeTexto";

describe("R11 — el módulo de captura no hace aritmética de coma flotante con dinero", () => {
  const codigo = quitarComentarios(fuente(MODULO_DE_CAPTURA));

  it("CONTROL DE NO-VACUIDAD: el módulo existe, suma en céntimos y su excepción es privada", () => {
    expect(codigo.length).toBeGreaterThan(500);
    expect(codigo, "ya no reusa el util puro de la 212").toContain(
      'from "@/lib/utils/pagos-recaudo"',
    );
    expect(codigo).toMatch(/\baCentimos\s*\(/);
    expect(codigo).toMatch(/\bsumaCuadra\s*\(/);
    // Si `montoDeTexto` se exportara, la excepción dejaría de estar acotada a este módulo.
    expect(codigo, "la excepción se exportó").not.toMatch(
      new RegExp(`export\\s+function\\s+${EXCEPCION_ACOTADA}`),
    );
  });

  it(`las ÚNICAS conversiones texto→número están dentro de \`${EXCEPCION_ACOTADA}\``, () => {
    const { desde, hasta } = rangoDeFuncion(codigo, EXCEPCION_ACOTADA);
    const encontradas = llamadasProhibidas(codigo);
    const fueraDeLaExcepcion = encontradas.filter((c) => c.indice < desde || c.indice >= hasta);

    expect(
      fueraDeLaExcepcion.map((c) => c.llamada),
      "hay conversión de dinero fuera de la frontera del input",
    ).toEqual([]);
    // NO-VACUIDAD: la excepción existe y se usa. Si mañana desapareciera, este caso avisaría en
    // vez de quedarse verde vigilando una regla que ya no rige.
    expect(encontradas.length, "la excepción quedó vacía: revisar si sigue haciendo falta")
      .toBeGreaterThan(0);
  });

  it("no hay ningún símbolo de moneda incrustado", () => {
    expect(codigo).not.toMatch(SIMBOLO_DE_MONEDA);
  });

  it("CONTRAPRUEBA: un `parseFloat` fuera de la excepción se caza", () => {
    const { desde, hasta } = rangoDeFuncion(codigo, EXCEPCION_ACOTADA);
    const mutado = `${codigo}\nconst total = parseFloat(linea.monto) + 1;`;

    const fuera = (f: string) =>
      llamadasProhibidas(f).filter((c) => c.indice < desde || c.indice >= hasta);

    expect(fuera(codigo)).toEqual([]);
    expect(fuera(mutado).map((c) => c.llamada)).toEqual(["parseFloat("]);
  });

  it("CONTRAPRUEBA: un símbolo de moneda inyectado se caza", () => {
    expect(SIMBOLO_DE_MONEDA.test(codigo)).toBe(false);
    expect(SIMBOLO_DE_MONEDA.test(`${codigo}\nconst etiqueta = "₡" + monto;`)).toBe(true);
  });
});

describe("R31 — los dos módulos de descarga siguen siendo MONEY-SAFE", () => {
  for (const ruta of MODULOS_DE_DESCARGA) {
    describe(ruta, () => {
      const codigo = quitarComentarios(fuente(ruta));

      it("CONTROL DE NO-VACUIDAD: existe, tiene cuerpo y proyecta el desglose", () => {
        expect(codigo.length).toBeGreaterThan(1000);
        expect(codigo, "ya no concatena el desglose en la celda escalar").toContain(
          "desgloseDescarga(",
        );
      });

      it("ni una conversión de dinero, ni un símbolo de moneda: AQUÍ no hay excepción", () => {
        // A diferencia del módulo de captura, estos no reciben input de nadie: el monto llega
        // como el STRING money-safe del servidor y sale tal cual a la celda. Cero excepciones.
        expect(llamadasProhibidas(codigo).map((c) => c.llamada)).toEqual([]);
        expect(codigo, "la excepción de la captura se coló aquí").not.toContain(EXCEPCION_ACOTADA);
        expect(codigo).not.toMatch(SIMBOLO_DE_MONEDA);
      });

      it("CONTRAPRUEBA: un `Number(` inyectado se caza", () => {
        const mutado = `${codigo}\nconst monto = Number(gestion.montoRecibido).toFixed(2);`;
        expect(llamadasProhibidas(codigo)).toEqual([]);
        expect(llamadasProhibidas(mutado).map((c) => c.llamada).sort()).toEqual([
          ".toFixed(",
          "Number(",
        ]);
      });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// R32 — la forma escalar del BORDE sigue viva. Su retiro es la ficha 214, no ésta.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Esto NO se afirma por grep de un comentario que diga «se conserva»: se EJECUTA el schema del
 * borde y se COMPILA el tipo del DTO. Un comentario sobrevive a que alguien borre el campo; un
 * `safeParse` verde, no.
 *
 * La afirmación sobre el DTO es de tipo, y por tanto la hace cumplir `pnpm run typecheck` (parte
 * del gate): si `metodoPago` desapareciera de `CierreDetalleGestion`, o dejara de admitir el
 * valor del enum, la línea de abajo no compila.
 */
const ESCALAR_SIGUE_EN_EL_DTO: Pick<CierreDetalleGestion, "metodoPago"> = { metodoPago: "SINPE" };

describe("R32 — el borde de escritura sigue aceptando `metodoPago` escalar", () => {
  const entregaConEscalar = {
    ordenId: "o1",
    ubicacion: { lat: 9.9281, lng: -84.0907 },
    resultado: "entregada",
    evidencias: [{ type: "image/jpeg", size: 1024 }],
    montoRecibido: 8000,
    metodoPago: "efectivo",
  };

  it("EJECUTABLE: una entrega con SOLO el escalar (sin `pagos`) sigue siendo válida", () => {
    const r = gestionarSchema.safeParse(entregaConEscalar);

    expect(r.success, "el borde dejó de aceptar la forma escalar: eso es la ficha 214").toBe(true);
    if (r.success && r.data.resultado === "entregada") {
      expect(r.data.metodoPago).toBe("efectivo");
      expect(r.data.pagos).toBeUndefined();
    }
  });

  it("EJECUTABLE: el DTO del cierre sigue exponiendo el campo escalar", () => {
    // La forma fuerte la comprueba el compilador (ver el `Pick` de arriba). En runtime se afirma
    // que el campo existe y admite el valor del enum, para que el caso no sea un comentario.
    expect(Object.keys(ESCALAR_SIGUE_EN_EL_DTO)).toEqual(["metodoPago"]);
    expect(ESCALAR_SIGUE_EN_EL_DTO.metodoPago).toBe("SINPE");
  });

  it("CONTROL DE NO-VACUIDAD: el mismo schema rechaza lo que SÍ tiene que rechazar", () => {
    // Sin esto, un `gestionarSchema` que aceptara CUALQUIER COSA daría verde el caso de arriba.
    const sinComo = gestionarSchema.safeParse({ ...entregaConEscalar, metodoPago: undefined });
    expect(sinComo.success, "el borde acepta un cobro sin decir cómo se cobró").toBe(false);

    const inventado = gestionarSchema.safeParse({ ...entregaConEscalar, metodoPago: "cripto" });
    expect(inventado.success, "el borde acepta un método fuera del catálogo").toBe(false);
  });

  it("la forma PURA de la 213 y la escalar de antes conviven: las DOS son válidas", () => {
    // R32 dicho como convivencia, que es lo que esta ficha necesita para poder mergearse sin
    // romper a nadie que aún envíe el escalar.
    const conDesglose = gestionarSchema.safeParse({
      ...entregaConEscalar,
      metodoPago: undefined,
      pagos: [
        { metodo: "efectivo", monto: 5000 },
        { metodo: "transferencia", monto: 3000 },
      ],
    });

    expect(conDesglose.success).toBe(true);
    expect(gestionarSchema.safeParse(entregaConEscalar).success).toBe(true);
  });
});
