// GUARDIA — FICHA 439: UN ENLACE CON PINTA DE BOTON PASA POR `cn`, SIEMPRE.
//
// ## El defecto que existio, medido en el navegador
//
// `components/shared/ErrorState.tsx` componia la salida segura de la pantalla de error asi:
//
//     <Link href={hrefInicio} className={buttonVariants({ variant: "outline" })}>
//
// y el resultado MEDIDO el 2026-09-17 sobre `/` con la frontera de error montada fue
// `border-top-color: rgba(0, 0, 0, 0)` con `background-color: rgb(247, 248, 252)` sobre un fondo
// de pagina del MISMO `rgb(247, 248, 252)`: la unica salida de la pantalla se leia como texto en
// negrita. Tras envolver en `cn(...)`, el mismo borde mide `rgb(227, 232, 242)` a 1px.
//
// ## Por que pasa, y por que NO lo ve ningun test de los normales
//
// La clase base de `buttonVariants` trae `border border-transparent`; la variante `outline` trae
// `border-border`. `cva` CONCATENA —no resuelve conflictos de Tailwind—, asi que las dos clases
// llegan vivas al DOM y gana la que la hoja de estilos ponga despues. `cn` es
// `twMerge(clsx(...))`, y twMerge es justo lo que colapsa el par y deja la ultima. El componente
// `<Button>` no lo sufre porque pasa por `cn` por dentro (`components/ui/button.tsx`); el que lo
// sufre es SIEMPRE el sitio donde alguien quiere la PINTA de boton sobre otro elemento —un
// `<Link>`, que tiene que ser un `<Link>` porque es navegacion, o un `Popover.Trigger`— y compone
// la clase a mano.
//
// Es la familia «el sistema no falla, aparenta»:
//   · Compila, pasa el lint, pasa los tipos.
//   · El elemento ESTA en el DOM, con su `href` y su texto: cualquier test que lo busque por rol
//     o por texto lo encuentra y da verde.
//   · Una captura de pantalla tampoco lo delata, porque lo que falta es un borde de 1px.
//     Se encontro mirando la app, no ejecutando la suite.
//
// ## Que exige esta guardia, y por que la version ESTRICTA
//
// La regla es: **toda llamada a `buttonVariants(...)` en el codigo de producto tiene que estar
// pasada DIRECTAMENTE a `cn(...)`**. Sin excepcion por variante.
//
// Se penso una version mas fina —exigir `cn` solo a las variantes que tocan el borde
// (`outline`, `brand-outline`, `destructive`...)— y se descarto por dos razones:
//
//   1. Esa lista hay que mantenerla a mano y en OTRO archivo distinto de `button.tsx`. La
//      variante que alguien anada manana con un `border-*` dentro nace fuera de la regla, en
//      silencio. La guardia protegeria exactamente lo que ya sabemos, que es lo que no hace falta.
//   2. **La version estricta no cuesta nada, y esta MEDIDO**: los tres sitios que usaban la
//      variante por defecto (`PostulacionForm`, `RecuperacionDesactivadaAviso`,
//      `RecuperarContrasenaForm`) se envolvieron en `cn` y se comparo en el navegador el 2026-09-17
//      a pelo contra envuelto sobre las dos variantes a la vez. Diferencias en la variante por
//      defecto: NINGUNA — ni en la cadena de clases, ni en color, borde, fondo, alto o radio. En
//      `outline`, la del defecto: `rgba(0, 0, 0, 0)` contra `rgb(227, 232, 242)`.
//
// O sea: el conflicto de clases no se COMPRUEBA sitio por sitio, se hace IMPOSIBLE de expresar.
//
// ## Como esta hecha
//
// Con el AST de TypeScript y no con un barrido de texto, a proposito. Un barrido de texto tiene
// que decidir si un `buttonVariants(` esta «dentro» de un `cn(` mirando hacia atras, y eso falla
// en las dos direcciones: da por malo `cn("h-8", buttonVariants({...}))` —que es correcto— y se
// deja enganar por un `cn(` que aparezca en un comentario o en una cadena. El AST responde la
// pregunta de verdad: cual es la llamada que ENVUELVE a esta.
//
// Lleva control de no-vacuidad (si el barrido deja de encontrar archivos, o deja de encontrar
// llamadas, se pone rojo en vez de decir «verde» sin haber mirado) y contraprueba (cada forma
// infractora esta escrita abajo y se exige que el detector la encuentre).
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Donde vive el codigo de PRODUCTO. `tests/` queda fuera a proposito y por un motivo concreto:
 * `tests/components/button.test.tsx` llama `buttonVariants({ variant: "brand-outline" })` a pelo
 * para afirmar sobre la cadena que devuelve `cva`. Ahi la salida CRUDA es el sujeto del test, no
 * una clase que alguien vaya a pintar; exigirle `cn` seria pedirle que mida otra cosa.
 */
const DIRECTORIOS = ["app", "components", "lib", "hooks", "providers"] as const;

/** La pieza donde vivio el defecto de esta ficha. Es el ancla de la regresion. */
const ANCLA = "components/shared/ErrorState.tsx";

/* ── EL DETECTOR ──────────────────────────────────────────────────────────────────────────── */

interface Uso {
  /** Ruta relativa a la raiz, con `/`. */
  archivo: string;
  linea: number;
  /** Nombre de la llamada que la envuelve, o `null` si no la envuelve ninguna. */
  envoltorio: string | null;
  /** El texto de la llamada, recortado, para que el mensaje del fallo sea accionable. */
  texto: string;
}

/**
 * Censa las llamadas a `buttonVariants(...)` de un fuente y dice, de cada una, QUIEN la envuelve.
 *
 * «Envuelve» = la llamada mas cercana hacia arriba en el arbol. Con eso:
 *   · `cn(buttonVariants({...}))`            -> envoltorio "cn"
 *   · `cn("h-8", buttonVariants({...}), x)`  -> envoltorio "cn"   (el orden del argumento da igual)
 *   · `buttonVariants({...})` a pelo          -> envoltorio null
 *   · `` `${buttonVariants({...})} extra` ``  -> envoltorio null   (la misma trampa, con plantilla)
 *   · `const c = buttonVariants({...})`       -> envoltorio null   (la indireccion tambien cuenta:
 *     el `cn` tiene que estar AQUI, donde se ve, y no a saber donde se use la variable despues)
 */
export function censarUsos(fuente: string, archivo: string): Uso[] {
  const arbol = ts.createSourceFile(
    archivo,
    fuente,
    ts.ScriptTarget.Latest,
    // Los punteros al padre son lo que permite preguntar «quien me envuelve».
    true,
    archivo.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const usos: Uso[] = [];

  function envoltorioDe(nodo: ts.Node): string | null {
    let actual: ts.Node | undefined = nodo.parent;
    while (actual) {
      if (ts.isCallExpression(actual)) {
        return ts.isIdentifier(actual.expression)
          ? actual.expression.text
          : actual.expression.getText(arbol);
      }
      actual = actual.parent;
    }
    return null;
  }

  function visitar(nodo: ts.Node): void {
    if (
      ts.isCallExpression(nodo) &&
      ts.isIdentifier(nodo.expression) &&
      nodo.expression.text === "buttonVariants"
    ) {
      const { line } = arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol));
      usos.push({
        archivo,
        linea: line + 1,
        envoltorio: envoltorioDe(nodo),
        texto: nodo.getText(arbol).replace(/\s+/g, " ").slice(0, 120),
      });
    }
    ts.forEachChild(nodo, visitar);
  }

  visitar(arbol);
  return usos;
}

/** Un uso infringe si no lo envuelve `cn`. */
function infringe(uso: Uso): boolean {
  return uso.envoltorio !== "cn";
}

/* ── EL BARRIDO DEL ARBOL ─────────────────────────────────────────────────────────────────── */

function esFuenteDeProducto(nombre: string): boolean {
  if (!nombre.endsWith(".ts") && !nombre.endsWith(".tsx")) return false;
  // Un test colocado junto al codigo seguiria el mismo criterio que `tests/`.
  return !nombre.includes(".test.") && !nombre.includes(".spec.");
}

function censarArchivos(): string[] {
  const encontrados: string[] = [];

  function recorrer(relativo: string): void {
    for (const entrada of readdirSync(path.join(RAIZ, relativo), { withFileTypes: true })) {
      const hijo = `${relativo}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name === ".next") continue;
        recorrer(hijo);
      } else if (esFuenteDeProducto(entrada.name)) {
        encontrados.push(hijo);
      }
    }
  }

  for (const dir of DIRECTORIOS) if (existsSync(path.join(RAIZ, dir))) recorrer(dir);
  return encontrados.sort();
}

const ARCHIVOS = censarArchivos();

/**
 * Solo se parsea lo que NOMBRA a `buttonVariants`. Es un prefiltro de coste, no de criterio: un
 * archivo que no contiene el identificador no puede llamarlo, y parsear 1.600 fuentes con el
 * compilador para encontrar nueve llamadas seria pagar segundos por nada.
 */
const CANDIDATOS = ARCHIVOS.filter((rel) =>
  readFileSync(path.join(RAIZ, rel), "utf8").includes("buttonVariants"),
);

const USOS = CANDIDATOS.flatMap((rel) =>
  censarUsos(readFileSync(path.join(RAIZ, rel), "utf8"), rel),
);

/* ── LOS CONTROLES DE NO-VACUIDAD ─────────────────────────────────────────────────────────── */

describe("guardia 439 — el barrido mira de verdad (no-vacuidad)", () => {
  it("los directorios de producto existen todos", () => {
    // Si `components/` se renombra manana, esta guardia se quedaria barriendo el vacio y diria
    // «verde». Que diga rojo y que alguien actualice la lista.
    const ausentes = DIRECTORIOS.filter((d) => !existsSync(path.join(RAIZ, d)));
    expect(ausentes).toEqual([]);
  });

  it("encuentra el grueso del arbol de fuentes", () => {
    // El arbol tenia 1.589 fuentes el 2026-09-17. El umbral va MUY por debajo a proposito: mide
    // «el recorrido funciona», no «el repo tiene este tamano».
    expect(ARCHIVOS.length).toBeGreaterThan(500);
  });

  it("encuentra llamadas reales a buttonVariants, en varios archivos", () => {
    // Nueve llamadas en ocho archivos el 2026-09-17 (mas la de dentro de `button.tsx`).
    expect(USOS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(USOS.map((u) => u.archivo)).size).toBeGreaterThanOrEqual(6);
  });

  it("sigue viendo la pieza donde vivio el defecto", () => {
    // El ancla de la regresion. Si `ErrorState` se renombra o se mueve, actualizar `ANCLA`:
    // es la pantalla de error, y su salida segura es el sitio exacto donde esto ya paso.
    const delAncla = USOS.filter((u) => u.archivo === ANCLA);
    expect(
      delAncla.length,
      `no se encontro ninguna llamada a buttonVariants en ${ANCLA}`,
    ).toBeGreaterThanOrEqual(1);
  });
});

/* ── LA REGLA ─────────────────────────────────────────────────────────────────────────────── */

describe("guardia 439 — toda pinta de boton pasa por cn", () => {
  it("ninguna llamada a buttonVariants se compone sin cn", () => {
    const infractores = USOS.filter(infringe).map(
      (u) =>
        `${u.archivo}:${u.linea} — envuelto por ${u.envoltorio ?? "NADA"}: ${u.texto}`,
    );

    expect(
      infractores,
      [
        "Hay clases de boton compuestas sin `cn(...)`.",
        "",
        "`cva` concatena y NO resuelve conflictos de Tailwind: la base de `buttonVariants` trae",
        "`border border-transparent` y variantes como `outline` traen `border-border`. Sin",
        "tailwind-merge sobreviven las dos y gana la de la base, asi que el control sale SIN",
        "BORDE —medido: `border-top-color: rgba(0, 0, 0, 0)`— y, con `bg-background` sobre una",
        "pagina del mismo color, se lee como texto suelto. Compila, pasa el lint y ningun test",
        "lo ve, porque el elemento SI esta en el DOM.",
        "",
        "Arreglo: `className={cn(buttonVariants({ ... }))}`, con el `buttonVariants` pasado",
        "directamente a `cn`. Ver `components/shared/ErrorState.tsx` (ficha 439).",
      ].join("\n"),
    ).toEqual([]);
  });
});

/* ── LA CONTRAPRUEBA: el detector se prueba contra codigo que SI infringe ─────────────────── */

describe("guardia 439 — el detector detecta (contraprueba)", () => {
  const CASOS: ReadonlyArray<{ nombre: string; fuente: string; infractores: number }> = [
    {
      nombre: "EL DEFECTO REAL: outline a pelo",
      fuente: `<Link href={h} className={buttonVariants({ variant: "outline" })}>x</Link>;`,
      infractores: 1,
    },
    {
      nombre: "la variante por defecto tambien: la regla es estricta",
      fuente: `<Link href="/login" className={buttonVariants({ className: "w-full" })}>x</Link>;`,
      infractores: 1,
    },
    {
      nombre: "sin argumentos tampoco se salva",
      fuente: `<Link href="/" className={buttonVariants()}>x</Link>;`,
      infractores: 1,
    },
    {
      nombre: "interpolado en una plantilla: la misma trampa con otra cara",
      fuente: "<a className={`${buttonVariants({ variant: \"outline\" })} ml-2`}>x</a>;",
      infractores: 1,
    },
    {
      nombre: "guardado en una variable: la indireccion esconde el conflicto igual",
      fuente: `const clases = buttonVariants({ variant: "outline" });`,
      infractores: 1,
    },
    {
      nombre: "envuelto en clsx, que concatena pero NO resuelve conflictos",
      fuente: `<a className={clsx(buttonVariants({ variant: "outline" }), "ml-2")}>x</a>;`,
      infractores: 1,
    },
    {
      nombre: "BIEN: envuelto en cn",
      fuente: `<Link href={h} className={cn(buttonVariants({ variant: "outline" }))}>x</Link>;`,
      infractores: 0,
    },
    {
      nombre: "BIEN: cn con mas clases detras",
      fuente: `<a className={cn(buttonVariants({ variant: "outline" }), "w-56 font-normal")}>x</a>;`,
      infractores: 0,
    },
    {
      nombre: "BIEN: cn con clases DELANTE — lo que un barrido de texto daria por malo",
      fuente: `<a className={cn("shrink-0", buttonVariants({ variant: "outline" }))}>x</a>;`,
      infractores: 0,
    },
    {
      nombre: "BIEN: cn en varias lineas, con un comentario por medio",
      fuente: [
        "<a",
        "  className={cn(",
        "    // el porque del sitio, que un barrido hacia atras se tragaria",
        '    buttonVariants({ variant: "outline" }),',
        '    "gap-2",',
        "  )}",
        ">x</a>;",
      ].join("\n"),
      infractores: 0,
    },
  ];

  for (const caso of CASOS) {
    it(caso.nombre, () => {
      const usos = censarUsos(caso.fuente, "caso-inyectado.tsx");
      // No-vacuidad DEL CASO: si el parseo no encontrara la llamada, «0 infractores» seria
      // verde por no haber mirado. Es el mismo modo de fallo que la guardia entera evita.
      expect(usos.length, `el detector no encontro la llamada en: ${caso.nombre}`).toBe(1);
      expect(usos.filter(infringe).length).toBe(caso.infractores);
    });
  }

  it("un uso correcto del arbol REAL deja de serlo si se le quita el cn", () => {
    // La mutacion, dentro de la propia guardia: se toma el fuente de verdad de la pieza anclada,
    // se le quita el `cn(` de la vida real y se exige que el detector se ponga rojo. Si alguien
    // afloja el detector, esta prueba cae aunque el arbol este arreglado.
    const fuente = readFileSync(path.join(RAIZ, ANCLA), "utf8");
    expect(censarUsos(fuente, ANCLA).filter(infringe)).toEqual([]);

    const mutado = fuente.replace(
      /cn\((buttonVariants\(\{[^}]*\}\))\)/,
      (_todo, llamada: string) => llamada,
    );
    expect(mutado, "la mutacion no cambio nada: revisar el patron").not.toBe(fuente);

    const infractoresMutados = censarUsos(mutado, ANCLA).filter(infringe);
    expect(infractoresMutados.length).toBeGreaterThanOrEqual(1);
  });
});
