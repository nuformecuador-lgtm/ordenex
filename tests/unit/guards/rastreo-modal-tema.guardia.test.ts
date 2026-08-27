import { existsSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 229 (T3.4) — GUARDIA de PALETA y de NO-PERSISTENCIA del modal de rastreo.
// Cubre R29 y la mitad estática de R30.
//
// ── QUÉ VIGILA, Y POR QUÉ CADA COSA
//
//  1. **R29 — el modal no gira con el tema.** La landing es clara POR DISEÑO (feature 208):
//     `app/page.tsx` monta su subárbol con `tema-claro`. El popup se PORTALEA fuera de ese
//     subárbol, así que allí ya no hereda nada y el `.dark` que la feature 211 pone en `<html>`
//     lo alcanzaría. La defensa vive en dos sitios y esta guardia cubre el segundo:
//       · el `tema-claro` explícito del `DialogContent` — lo mide el test de componente;
//       · que estos archivos no introduzcan color propio (hex, `rgb(`) ni variantes `dark:`,
//         que es lo que `tema-claro` NO apaga: fija los TOKENS, no el variant, que se define
//         contra el ancestro (`@custom-variant dark (&:is(.dark *))`, `app/globals.css`).
//  2. **R30 — el RESULTADO muere al cerrar.** Un `router.push` o un `localStorage` metidos
//     «para que no se pierda» convertirían el estado de un envío en algo que sobrevive a la
//     recarga y se comparte por WhatsApp. Se vigila estáticamente porque un test de
//     comportamiento solo ve lo que el caso concreto ejercita.
//
//     ⚠ REVISADO EL 2026-08-26, y por eso este punto ya no dice lo que decía. El 2026-08-15 se
//     descartó la URL enlazable y esta guardia prohibía `searchParams` A SECAS. Hoy la landing
//     SÍ acepta `/?guia=<n>`: el enlace abre el modal con la guía puesta. Es una decisión
//     humana POSTERIOR, no el descuido que la guardia venía a atrapar. Lo que NO cambió —y es
//     lo que se sigue sosteniendo aquí— es el límite:
//       · la guía se PRECARGA, no se consulta: el segundo factor se sigue tecleando, así que
//         un enlace no revela si esa guía existe y el barrido de `num_guia` sigue cerrado;
//       · el RESULTADO no va a la URL, ni al storage, ni a otra pantalla;
//       · desde el modal la URL solo PIERDE datos: al cerrar se retira el `?guia=` con
//         `history.replaceState`, y no hay ninguna escritura que la haga crecer.
//     De ahí la forma nueva de la prohibición: `useSearchParams` —el modal no lee la URL, la
//     guía le baja como prop desde el servidor— y toda ESCRITURA (`searchParams.set/append`,
//     `history.pushState`) siguen prohibidos. `has`/`delete` con `replaceState`, que es como se
//     retira el parámetro, es lo único que se admite, y tiene su propio caso más abajo.
//
// La lectura es ESTÁTICA y sobre el CÓDIGO, no sobre la prosa: los comentarios de estos
// archivos NOMBRAN a propósito lo que está prohibido (este mismo comentario lo hace), así que
// se pasa el quitador compartido de la feature 209 antes de mirar.

const RAIZ = path.resolve(__dirname, "../../..");

/** Los archivos de UI que ESTA feature escribe o toca. */
const ARCHIVOS_DE_UI = [
  "app/_landing/RastreoDialog.tsx",
  "app/_landing/LandingNav.tsx",
] as const;

/**
 * Lo prohibido, cada patrón con el porqué que se le enseña a quien lo encuentre.
 *
 * El hex se busca con `#` + 3, 4, 6 u 8 dígitos: es la forma en la que un color ad-hoc entra
 * de verdad en una clase de Tailwind (`text-[#f26419]`) o en un estilo en línea.
 */
const PROHIBIDO: { patron: RegExp; nombre: string; porque: string }[] = [
  {
    patron: /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b/,
    nombre: "literal hexadecimal",
    porque:
      "R29: el color sale de los tokens de marca (`brand`, `navy-deep`, `asfalto-*`, " +
      "`kraft-*`). Un hex ad-hoc queda fuera del sistema y nadie lo mueve cuando la paleta cambia.",
  },
  {
    patron: /\brgba?\(/,
    nombre: "color `rgb(`/`rgba(`",
    porque: "R29: mismo motivo que el hex — color escrito a mano fuera de la paleta.",
  },
  {
    patron: /\bdark:/,
    nombre: "variante `dark:`",
    porque:
      "R29: el modal NO gira con el tema. Y `tema-claro` no lo salvaría: fija los tokens, " +
      "no apaga el variant, que se define contra el ancestro `.dark`.",
  },
  {
    patron: /\blocalStorage\b/,
    nombre: "`localStorage`",
    porque: "R30: el resultado muere al cerrar el diálogo; no sobrevive a una recarga.",
  },
  {
    patron: /\bsessionStorage\b/,
    nombre: "`sessionStorage`",
    porque: "R30: ídem.",
  },
  {
    patron: /\buseSearchParams\b|\bsearchParams\.(?:set|append)\b|\bhistory\.pushState\b/,
    nombre: "lectura de la URL o ESCRITURA en ella",
    porque:
      "R30 (revisado el 2026-08-26): la guía entra por la URL como PROP desde el servidor, no " +
      "leyéndola aquí, y desde el modal la URL solo pierde datos. Un `searchParams.set`, un " +
      "`history.pushState` o un `useSearchParams` devolverían el estado del envío a la barra " +
      "de direcciones, que es lo que R30 cierra.",
  },
  {
    patron: /\brouter\.push\b|\buseRouter\b/,
    nombre: "navegación por router",
    porque:
      "R26/R30: el resultado se pinta DENTRO del mismo diálogo, sin navegar. Un `push` " +
      "convertiría el modal en un paso hacia otra pantalla.",
  },
];

/** El CÓDIGO de cada archivo vigilado, con la prosa fuera. */
const CODIGO = new Map<string, string>(
  ARCHIVOS_DE_UI.map((relativa) => [relativa, codigoSinComentarios(relativa)]),
);

// ---------------------------------------------------------------------------
// 0 — Anti-vacuidad: el censo lee archivos de verdad, y el detector muerde
// ---------------------------------------------------------------------------

describe("rastreo público — la guardia de tema mira algo", () => {
  it("los archivos de UI de la feature existen, se leyeron y no están vacíos", () => {
    // Sin esto, un archivo renombrado dejaría todos los escaneos de abajo sobre cadenas
    // vacías y la guardia pasaría en verde sin haber mirado nada — el modo de fallo que ya
    // se dio en este repo («la guardia verde porque no encontraba nada»).
    for (const relativa of ARCHIVOS_DE_UI) {
      expect(existsSync(path.join(RAIZ, relativa)), `no existe ${relativa}`).toBe(true);
      expect((CODIGO.get(relativa) ?? "").trim().length, `${relativa} se leyó vacío`).toBeGreaterThan(
        400,
      );
    }
    // Y que lo leído es el modal y su disparador, no otra cosa que se llame igual.
    expect(CODIGO.get("app/_landing/RastreoDialog.tsx")).toContain("DialogContent");
    expect(CODIGO.get("app/_landing/LandingNav.tsx")).toContain("RastreoDialog");
  });

  it("el detector encuentra cada prohibición cuando está plantada, y no la confunde con prosa", () => {
    // Control positivo, patrón a patrón: un censo que no muerde es una promesa.
    const plantado = [
      'const color = "#f26419";',
      'const otro = "text-[#fff]";',
      'const sombra = "rgba(0,0,0,.2)";',
      'const clase = "bg-white dark:bg-navy-deep";',
      "localStorage.setItem('guia', numGuia);",
      "sessionStorage.setItem('guia', numGuia);",
      "const params = useSearchParams();",
      "url.searchParams.set('guia', numGuia);",
      "window.history.pushState(null, '', `/?guia=${numGuia}`);",
      "router.push(`/rastreo/${numGuia}`);",
    ].join("\n");
    for (const { patron, nombre } of PROHIBIDO) {
      expect(patron.test(plantado), `el detector no ve ${nombre}`).toBe(true);
    }

    // Y la prosa NO cuenta: si contara, habría que borrar la explicación para pasar la
    // guardia, que es exactamente lo que la feature 209 vino a cerrar.
    const soloProsa = quitarComentarios(
      ["// aquí no se usa localStorage ni dark: ni #f26419", "const x = 1;"].join("\n"),
    );
    for (const { patron } of PROHIBIDO) {
      expect(patron.test(soloProsa)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// R29 / R30 — el censo sobre los archivos reales
// ---------------------------------------------------------------------------

describe("R29/R30 — los archivos de UI no usan hex, rgb, variantes dark, storage, searchParams ni router", () => {
  it.each(ARCHIVOS_DE_UI)("%s se pinta con la paleta de la landing y no persiste nada", (relativa) => {
    const codigo = CODIGO.get(relativa) as string;
    for (const { patron, nombre, porque } of PROHIBIDO) {
      const encontrado = codigo.match(new RegExp(patron.source, "g")) ?? [];
      expect(encontrado, `${relativa} usa ${nombre}. ${porque}`).toEqual([]);
    }
  });

  it("desde el modal la URL solo PIERDE datos: `has`/`delete` y `replaceState`, nada más", () => {
    // El límite que sustituye a la prohibición de 2026-08-15 (ver cabecera). No se mide que el
    // parámetro se retire —eso lo ejercita `tests/components/RastreoDialog.test.tsx`, cerrando
    // el diálogo de verdad—, sino que NO EXISTA otra forma de tocar la URL: aquí se ve el
    // archivo entero, incluidas las ramas que ningún caso llegue a recorrer.
    const codigo = CODIGO.get("app/_landing/RastreoDialog.tsx") as string;

    const usosDeQuery = codigo.match(/\bsearchParams\.\w+/g) ?? [];
    expect(usosDeQuery.length, "el modal ya no toca la URL: revisa si este caso sigue vivo")
      .toBeGreaterThan(0);
    for (const uso of usosDeQuery) {
      expect(["searchParams.has", "searchParams.delete"], `${uso} escribe en la URL`).toContain(
        uso,
      );
    }

    const usosDeHistorial = codigo.match(/\bhistory\.\w+/g) ?? [];
    for (const uso of usosDeHistorial) {
      // `replaceState` sustituye la entrada actual; `pushState` añadiría una, y entonces
      // «volver» devolvería la landing CON la guía otra vez en la barra.
      expect(["history.replaceState", "history.state"], `${uso} no es un retiro`).toContain(uso);
    }
  });

  it("el `DialogContent` del modal lleva `tema-claro` EXPLÍCITO", () => {
    // El popup se portalea fuera del subárbol claro de la landing: sin esta clase, el `.dark`
    // del envoltorio del portal (feature 211) vuelve oscuro el modal en mitad de una landing
    // clara. Es el riesgo concreto de esta feature, y aquí se ancla por escrito.
    const codigo = CODIGO.get("app/_landing/RastreoDialog.tsx") as string;
    const apertura = codigo.indexOf("<DialogContent");
    expect(apertura, "no se encontró el `DialogContent` del modal").toBeGreaterThan(-1);
    const etiqueta = codigo.slice(apertura, codigo.indexOf(">", apertura));
    expect(
      etiqueta,
      "el `DialogContent` perdió su `tema-claro`: el modal volverá a girar con el tema (R29)",
    ).toContain("tema-claro");
  });
});
