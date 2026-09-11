import { describe, it, expect } from "vitest";

import { motivoGestionLegible } from "@/app/(app)/cierres-admin/_components/cierre-labels";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";

// FICHA 408 — el traductor del motivo de una gestión (R1, R2, R3, R5, R7, R11, R12).
//
// ⚠️ TODOS LOS LITERALES SE ESCRIBEN A MANO, y es la regla más importante de este archivo.
// Ni un caso compara la salida contra `CAUSA_DEVOLUCION_LABEL`, contra
// `MOTIVO_RECHAZO_AUTOMATICO_COLA` ni contra otra llamada a `motivoGestionLegible`: comparar un
// texto contra la función que lo genera sale verde aunque las palabras se rompan enteras
// («aserción contra su propia fuente», un fallo ya medido en este repo). Las tres etiquetas son
// las aprobadas el 2026-07-15 (feature 73) y se teclean aquí como las lee el usuario.
//
// ⚠️ CADA CASO SE CORRE CON LAS DOS VARIANTES. Un texto que sólo cambia de forma en una de las
// dos es exactamente donde se cuela un caso sin cubrir: `true` es la fila que enseña el marcador
// «Automático» (las pantallas de admin), `false` es la que no lo enseña ni puede enseñarlo
// (`/cierre-dia`, por `CierreDiaRepository`).

/** Las tres etiquetas del vocabulario aprobado, tecleadas. */
const CLIENTE_NO_LOCALIZADO = "Cliente no localizado";
const CELULAR_ERRADO = "Número de celular errado";
const DIRECCION_ERRADA = "Dirección errada";

/** Los tres textos autosuficientes, completos y tecleados enteros (R11). */
const CLIENTE_NO_LOCALIZADO_LARGO =
  "Cliente no localizado · lo rechazó el sistema al vencerse el plazo de la devolución";
const CELULAR_ERRADO_LARGO =
  "Número de celular errado · lo rechazó el sistema al vencerse el plazo de la devolución";
const DIRECCION_ERRADA_LARGO =
  "Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución";

/** Las dos variantes, para recorrerlas en los casos que deben comportarse igual en ambas. */
const LAS_DOS_VARIANTES = [
  { hayMarcadorDeOrigen: true, nombre: "con marcador de origen a la vista" },
  { hayMarcadorDeOrigen: false, nombre: "sin marcador de origen" },
] as const;

describe("R1 — la plantilla del cron se lee en castellano cuando la fila lleva marcador", () => {
  it("«escalado SLA not_found» se pinta «Cliente no localizado»", () => {
    expect(motivoGestionLegible("escalado SLA not_found", true)).toBe(CLIENTE_NO_LOCALIZADO);
  });

  it("«escalado SLA wrong_number» se pinta «Número de celular errado»", () => {
    expect(motivoGestionLegible("escalado SLA wrong_number", true)).toBe(CELULAR_ERRADO);
  });

  it("«escalado SLA wrong_address» se pinta «Dirección errada»", () => {
    // Es la cadena EXACTA que el humano reportó viendo en producción (R10): se usa tal cual,
    // sin migración ni backfill de por medio.
    expect(motivoGestionLegible("escalado SLA wrong_address", true)).toBe(DIRECCION_ERRADA);
  });

  it("en NINGUNA de las tres se cuela la sigla ni el value en inglés", () => {
    for (const salida of [
      motivoGestionLegible("escalado SLA not_found", true),
      motivoGestionLegible("escalado SLA wrong_number", true),
      motivoGestionLegible("escalado SLA wrong_address", true),
    ]) {
      expect(salida).not.toContain("SLA");
      expect(salida).not.toContain("escalado");
      expect(salida).not.toMatch(/not_found|wrong_number|wrong_address/);
    }
  });
});

describe("R11 — sin marcador de origen, el texto se sostiene solo", () => {
  it("«escalado SLA not_found» dice la causa Y que lo rechazó el sistema", () => {
    expect(motivoGestionLegible("escalado SLA not_found", false)).toBe(
      CLIENTE_NO_LOCALIZADO_LARGO,
    );
  });

  it("«escalado SLA wrong_number» dice la causa Y que lo rechazó el sistema", () => {
    expect(motivoGestionLegible("escalado SLA wrong_number", false)).toBe(CELULAR_ERRADO_LARGO);
  });

  it("«escalado SLA wrong_address» dice la causa Y que lo rechazó el sistema", () => {
    expect(motivoGestionLegible("escalado SLA wrong_address", false)).toBe(DIRECCION_ERRADA_LARGO);
  });

  it("el texto largo NO depende de ningún tooltip: nombra al sistema y al plazo, sin sigla", () => {
    // El límite declarado de la ficha: la nota del marcador vive en `title`/`aria-label` y en
    // táctil no existe. Por eso esto se afirma sobre el texto que SÍ se ve.
    const salida = motivoGestionLegible("escalado SLA wrong_address", false);
    expect(salida).toContain("lo rechazó el sistema");
    expect(salida).toContain("plazo de la devolución");
    expect(salida).not.toContain("SLA");
  });

  it("la variante larga es DISTINTA de la corta: la cola no es decorado", () => {
    // Si alguien borrara la cola, las dos ramas devolverían lo mismo y la mitad del contrato
    // dejaría de existir sin que ningún otro caso lo notara.
    expect(motivoGestionLegible("escalado SLA wrong_address", false)).not.toBe(
      motivoGestionLegible("escalado SLA wrong_address", true),
    );
  });
});

describe("R12 — las dos variantes nombran la causa con la MISMA palabra", () => {
  it("el texto largo contiene, literalmente, la etiqueta de la variante corta", () => {
    // Se pone rojo si alguien forka el vocabulario en una de las dos ramas («dirección
    // incorrecta» en una y «Dirección errada» en la otra).
    expect(motivoGestionLegible("escalado SLA not_found", false)).toContain(
      CLIENTE_NO_LOCALIZADO,
    );
    expect(motivoGestionLegible("escalado SLA wrong_number", false)).toContain(CELULAR_ERRADO);
    expect(motivoGestionLegible("escalado SLA wrong_address", false)).toContain(DIRECCION_ERRADA);
  });

  it("y la corta es EXACTAMENTE esa etiqueta, sin prefijo ni cola", () => {
    expect(motivoGestionLegible("escalado SLA not_found", true)).toBe(CLIENTE_NO_LOCALIZADO);
    expect(motivoGestionLegible("escalado SLA wrong_number", true)).toBe(CELULAR_ERRADO);
    expect(motivoGestionLegible("escalado SLA wrong_address", true)).toBe(DIRECCION_ERRADA);
  });
});

describe("R2 — lo que NO es exactamente la plantilla sale intacto, en las dos variantes", () => {
  for (const { hayMarcadorDeOrigen, nombre } of LAS_DOS_VARIANTES) {
    it(`el texto libre del mensajero no se toca (${nombre})`, () => {
      expect(motivoGestionLegible("El cliente no contesta el timbre", hayMarcadorDeOrigen)).toBe(
        "El cliente no contesta el timbre",
      );
    });

    it(`una frase que CONTIENE la plantilla dentro sale igual (${nombre})`, () => {
      // El emparejamiento es por igualdad exacta de la cadena completa. Con `includes` o
      // `startsWith`, este caso saldría mutilado — y es texto que escribió una persona.
      expect(
        motivoGestionLegible(
          "ojo: escalado SLA wrong_address según me dijeron",
          hayMarcadorDeOrigen,
        ),
      ).toBe("ojo: escalado SLA wrong_address según me dijeron");
    });

    it(`la cadena VACÍA sigue vacía y no se vuelve nula (${nombre})`, () => {
      expect(motivoGestionLegible("", hayMarcadorDeOrigen)).toBe("");
    });

    it(`la plantilla en otra caja NO se traduce (${nombre})`, () => {
      // Sin `toLowerCase`: normalizar la caja abriría la puerta a normalizar espacios y
      // acentos, y de ahí a deformar el texto de una persona.
      expect(motivoGestionLegible("Escalado sla wrong_address", hayMarcadorDeOrigen)).toBe(
        "Escalado sla wrong_address",
      );
    });

    it(`un motivo que sólo se parece por el prefijo tampoco se traduce (${nombre})`, () => {
      expect(motivoGestionLegible("escalado SLA", hayMarcadorDeOrigen)).toBe("escalado SLA");
      expect(motivoGestionLegible("escalado SLA wrong_address ", hayMarcadorDeOrigen)).toBe(
        "escalado SLA wrong_address ",
      );
    });

    it(`una clave del prototipo de Object no se confunde con una traducción (${nombre})`, () => {
      // El emparejador es un `Map` justamente por esto: con un objeto plano, `"constructor"`
      // devolvería una función y la celda pintaría basura.
      expect(motivoGestionLegible("constructor", hayMarcadorDeOrigen)).toBe("constructor");
      expect(motivoGestionLegible("__proto__", hayMarcadorDeOrigen)).toBe("__proto__");
    });
  }
});

describe("R5 — una causa que el catálogo no conoce sale tal cual", () => {
  for (const { hayMarcadorDeOrigen, nombre } of LAS_DOS_VARIANTES) {
    it(`«escalado SLA direccion_incompleta» se muestra idéntico (${nombre})`, () => {
      const salida = motivoGestionLegible(
        "escalado SLA direccion_incompleta",
        hayMarcadorDeOrigen,
      );
      expect(salida).toBe("escalado SLA direccion_incompleta");
      // Y explícitamente: ni `undefined`, ni `null`, ni cadena vacía. Un dato guardado que se
      // evapora es peor que un dato feo.
      expect(salida).not.toBeUndefined();
      expect(salida).not.toBeNull();
      expect(salida).not.toBe("");
    });
  }
});

describe("R3 — un motivo ausente sigue siendo ausente", () => {
  for (const { hayMarcadorDeOrigen, nombre } of LAS_DOS_VARIANTES) {
    it(`nulo devuelve nulo, y JAMÁS el guion de pantalla (${nombre})`, () => {
      // El `"—"` es un marcador de PANTALLA. Colapsarlo aquí lo metería dentro del Excel, donde
      // la celda tiene que ir vacía (R10 de la feature 170).
      const salida = motivoGestionLegible(null, hayMarcadorDeOrigen);
      expect(salida).toBeNull();
      expect(salida).not.toBe("—");
      expect(salida).not.toBe("");
    });
  }
});

describe("R7 — la traducción no toca el dato", () => {
  it("la gestión que se le pasa queda EXACTAMENTE igual", () => {
    const gestion: Pick<CierreDetalleGestion, "motivo" | "esRechazoSla"> = Object.freeze({
      motivo: "escalado SLA wrong_address",
      esRechazoSla: true,
    });
    const antes = JSON.parse(JSON.stringify(gestion)) as unknown;

    motivoGestionLegible(gestion.motivo, gestion.esRechazoSla);

    expect(gestion.motivo).toBe("escalado SLA wrong_address");
    expect(gestion.esRechazoSla).toBe(true);
    expect(JSON.parse(JSON.stringify(gestion))).toEqual(antes);
  });

  it("dos invocaciones seguidas con la misma entrada dan el mismo valor", () => {
    const primera = motivoGestionLegible("escalado SLA wrong_address", false);
    const segunda = motivoGestionLegible("escalado SLA wrong_address", false);
    expect(primera).toBe(segunda);
    // Y el valor es el esperado, no «dos veces lo mismo pero equivocado».
    expect(primera).toBe(DIRECCION_ERRADA_LARGO);
  });

  it("traducir una entrada no altera lo que devuelve la siguiente", () => {
    // Un emparejador con estado (un `lastIndex` de regex global, un caché mal llevado) se
    // delataría aquí: la segunda llamada de la misma cadena saldría distinta.
    expect(motivoGestionLegible("escalado SLA not_found", true)).toBe(CLIENTE_NO_LOCALIZADO);
    expect(motivoGestionLegible("El cliente no contesta el timbre", true)).toBe(
      "El cliente no contesta el timbre",
    );
    expect(motivoGestionLegible("escalado SLA not_found", true)).toBe(CLIENTE_NO_LOCALIZADO);
  });
});
