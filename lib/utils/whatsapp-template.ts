// Integracion WhatsApp — helpers PUROS (sin side effects, sin red) que traducen entre el
// cuerpo local de una plantilla (`{{clave}}`, variables NOMBRADAS, feature 107) y el formato
// de Message Template de Meta (parametros NUMERADOS `{{1}}` con valores de ejemplo).
//
// UN SOLO INVARIANTE DE ORDEN: la posicion de una variable en el array `variables` (que el
// service DERIVA del cuerpo, dedup + orden de aparicion, ver `extraerVariables`) ES su numero
// de parametro en Meta. `variables[0]` -> `{{1}}`, `variables[1]` -> `{{2}}`, etc. Ese mismo
// orden se respeta al ENVIAR, asi que crear/editar y enviar hablan del mismo mapeo.

import { EJEMPLOS_POR_CLAVE } from "@/lib/types/plantilla-datos";

// Mismo placeholder que `lib/utils/plantilla-mensaje.ts` (R14): `{{` + clave [a-z0-9_]+ + `}}`.
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Convierte el cuerpo local a la notacion numerada de Meta: cada `{{clave}}` pasa a
 * `{{N}}`, con `N` = posicion (1-based) de la clave en `variables`. Una clave que no este
 * en `variables` (no deberia ocurrir: `variables` se deriva del mismo cuerpo) se deja igual.
 */
export function cuerpoANumerado(cuerpo: string, variables: string[]): string {
  const posicion = new Map(variables.map((clave, i) => [clave, i + 1]));
  return cuerpo.replace(PLACEHOLDER_RE, (full, rawClave: string) => {
    const n = posicion.get(rawClave.trim().toLowerCase());
    return n !== undefined ? `{{${n}}}` : full;
  });
}

/**
 * Valor de ejemplo que Meta EXIGE por cada parametro del body al crear/editar un template.
 * Sale del catalogo de campos (`lib/types/plantilla-datos.ts`) si la clave esta declarada; si
 * no, un marcador no vacio derivado de la clave, porque Meta rechaza ejemplos vacios.
 *
 * Feature 282: antes se leia el catalogo VACIO de `plantilla-variables.ts`, asi que TODA clave
 * caia al marcador y a Meta viajaba `MONTO` como ejemplo del monto. Ahora viaja `₡12.500`, el
 * mismo valor que el maestro ve en la vista previa (R12). El alcance del cambio es acotado:
 * solo el `example.body_text` de los create/update FUTUROS. Ni el `text` aprobado, ni el orden
 * de los parametros, ni ninguna plantilla ya aprobada se reenvia por esto (design §4.4).
 */
function ejemploDe(clave: string): string {
  const ej = EJEMPLOS_POR_CLAVE[clave];
  return ej !== undefined && ej !== "" ? ej : clave.toUpperCase();
}

/**
 * Componentes del template para CREATE/UPDATE en Meta. Solo se genera el componente BODY
 * (header/footer/botones quedan fuera de este alcance). Si el cuerpo tiene variables, se
 * adjunta `example.body_text` con un ejemplo por parametro, en el MISMO orden que `variables`.
 */
export function construirComponentsTemplate(cuerpo: string, variables: string[]): unknown[] {
  const body: Record<string, unknown> = {
    type: "BODY",
    text: cuerpoANumerado(cuerpo, variables),
  };
  if (variables.length > 0) {
    // Meta espera un array de "conjuntos de ejemplo"; con un solo conjunto basta.
    body.example = { body_text: [variables.map(ejemploDe)] };
  }
  return [body];
}

/**
 * Componentes para ENVIAR un template: los parametros del body en el MISMO orden que
 * `variables`, tomando el valor de `valores[clave]` (una clave sin valor cae a cadena
 * vacia; el llamador es responsable de resolver todos los valores de la orden). Sin
 * variables -> array vacio (template estatico).
 */
export function construirComponentsEnvio(
  variables: string[],
  valores: Record<string, string>,
): unknown[] {
  if (variables.length === 0) return [];
  return [
    {
      type: "body",
      parameters: variables.map((clave) => ({
        type: "text",
        text: valores[clave] ?? "",
      })),
    },
  ];
}
