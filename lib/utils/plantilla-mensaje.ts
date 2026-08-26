// Feature 107 (design §2): helpers PUROS (sin side effects) para los campos variables
// `{{clave}}` del cuerpo de una plantilla. No hay lista blanca cerrada: cualquier clave
// bien formada se ACEPTA (Decision humana 4); solo se valida la FORMA (R16).

import {
  CAMPOS_PLANTILLA_POR_CLAVE,
  DATOS_PLANTILLA_EJEMPLO,
  resolverValoresPlantilla,
} from "@/lib/types/plantilla-datos";

// R14: un placeholder es `{{` + espacios opcionales + `clave` + espacios opcionales +
// `}}`, con `clave` = [a-z0-9_]+ (se admiten espacios internos que se normalizan).
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// R16: cualquier llave doble `{{ ... }}` cuyo contenido NO sea una unica clave bien
// formada (p. ej. `{{}}`, `{{ }}`, `{{a b}}`, `{{á}}`) es MALFORMADA. Captura el
// contenido bruto para reportarlo.
const LLAVE_DOBLE_RE = /\{\{([^}]*)\}\}/g;
const CLAVE_VALIDA_RE = /^[a-z0-9_]+$/;

/**
 * R15: claves bien formadas del cuerpo, normalizadas (trim + lowercase), DEDUPLICADAS y
 * en orden de aparicion. Esto es lo que se persiste en la columna `variables`.
 */
export function extraerVariables(cuerpo: string): string[] {
  const vistas = new Set<string>();
  const orden: string[] = [];
  for (const match of cuerpo.matchAll(PLACEHOLDER_RE)) {
    const clave = match[1].trim().toLowerCase();
    if (!vistas.has(clave)) {
      vistas.add(clave);
      orden.push(clave);
    }
  }
  return orden;
}

export type ValidarCuerpoResult =
  | { ok: true; variables: string[] }
  | { ok: false; malformadas: string[] };

/**
 * R16: valida SOLO la forma de los placeholders. Detecta llaves dobles malformadas
 * (contenido que, tras `trim`, no cumple [a-z0-9_]+). NO valida pertenencia a un
 * catalogo (Decision humana 4). En caso `ok`, `variables` es el array a persistir (R15).
 */
export function validarCuerpo(cuerpo: string): ValidarCuerpoResult {
  const malformadas: string[] = [];
  for (const match of cuerpo.matchAll(LLAVE_DOBLE_RE)) {
    const contenido = match[1].trim().toLowerCase();
    if (!CLAVE_VALIDA_RE.test(contenido)) {
      malformadas.push(match[0]);
    }
  }
  if (malformadas.length > 0) return { ok: false, malformadas };
  return { ok: true, variables: extraerVariables(cuerpo) };
}

/**
 * R18/R19: sustituye TODAS las ocurrencias de cada placeholder por su valor en `valores`.
 * Una clave bien formada AUSENTE en `valores` cae a un marcador derivado (clave en
 * MAYUSCULAS), nunca rompe la salida. NO altera el texto que no sea un placeholder.
 */
export function renderPlantilla(cuerpo: string, valores: Record<string, string>): string {
  return cuerpo.replace(PLACEHOLDER_RE, (_full, rawClave: string) => {
    const clave = rawClave.trim().toLowerCase();
    const valor = valores[clave];
    return valor !== undefined ? valor : clave.toUpperCase();
  });
}

/**
 * Vista previa «asi lo vera el cliente»: el cuerpo YA RESUELTO con los datos de ejemplo del
 * catalogo (feature 282, R10/R11).
 *
 * Es LITERALMENTE el mismo par de llamadas que hace el envio real (design §4.3) —
 * `renderPlantilla(cuerpo, resolverValoresPlantilla(variables, datos))`, tal como lo escribe
 * `EnviarPlantillaWhatsappButton`—, cambiando solo el `datos`. No hay un renderizador de
 * preview: si manana el envio cambia de motor y la preview no, dejan de coincidir EN PANTALLA
 * y el maestro lo ve antes de mandar nada.
 *
 * A PROPOSITO: una clave fuera del catalogo resuelve a cadena vacia, asi que la preview
 * muestra EL HUECO REAL que le llegaria al cliente, no el marcador `SUCURSAL` en mayusculas
 * que pintaba la version anterior (el antiguo R25 de la feature 107 queda derogado, design
 * §4.3 «Contradiccion resuelta»). Quien avisa de esa clave es `clavesSinCampo`, no un
 * marcador que el cliente nunca veria. El marcador de `renderPlantilla` sigue vivo como red de
 * seguridad para llamadores que no resuelvan todas las claves, pero ya no es alcanzable desde
 * aqui: `resolverValoresPlantilla` devuelve una entrada por CADA clave extraida.
 */
export function previewConEjemplos(cuerpo: string): string {
  return renderPlantilla(
    cuerpo,
    resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO),
  );
}

/**
 * Snapshot `clave -> nombre` para las claves que HOY estan en el catalogo (feature 282,
 * R17/R20).
 *
 * Recorre `variables` EN SU ORDEN y devuelve un objeto, asi que no puede reordenar ni
 * deduplicar nada por construccion (R19): el array que define la posicion del parametro de
 * Meta no se toca. Una clave fuera del catalogo NO entra en el mapa —no se le inventa un
 * nombre (R20)—, y esa ausencia es justo lo que hace decidible la distincion de R16 entre
 * «campo retirado del catalogo» y «clave que nunca fue valida».
 */
export function nombresDeVariables(variables: string[]): Record<string, string> {
  const nombres: Record<string, string> = {};
  for (const clave of variables) {
    const campo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
    if (campo !== undefined) nombres[clave] = campo.nombre;
  }
  return nombres;
}

/**
 * Etiqueta a mostrar para una clave, con sus caidas: snapshot persistido -> catalogo vigente
 * -> la propia clave (feature 282, R13/R21).
 *
 * El snapshot gana al catalogo A PROPOSITO: es lo que la plantilla decia cuando se guardo, y
 * una plantilla aprobada por Meta sobrevive a varias versiones del catalogo. `enCatalogo`
 * responde a otra pregunta —si la clave se va a RESOLVER hoy— y por eso no mira el snapshot.
 */
export function etiquetaDeVariable(
  clave: string,
  nombresPersistidos: Record<string, string>,
): { texto: string; enCatalogo: boolean } {
  const campo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
  const persistido = nombresPersistidos[clave];
  return {
    texto: persistido !== undefined ? persistido : (campo?.nombre ?? clave),
    enCatalogo: campo !== undefined,
  };
}

/**
 * Claves del cuerpo que NO se van a reemplazar: las bien formadas que no estan en el catalogo
 * (feature 282, R15/R16). Llegarian VACIAS al cliente.
 *
 * `retirada: true` cuando la clave SI tiene nombre en el snapshot (estuvo en el catalogo y
 * alguien la quito); `false` cuando no lo tiene (nunca fue valida). La distincion es exacta
 * porque el snapshot solo guarda nombres de claves del catalogo (`nombresDeVariables`).
 *
 * AVISA, NO BLOQUEA: `validarCuerpo` sigue siendo la unica puerta que rechaza (Decision
 * humana 4 de la feature 107). Hay cuerpos vivos con claves fuera del catalogo y bloquear el
 * guardado los dejaria sin poder editarse nunca mas, ni siquiera para quitar la clave rota.
 */
export function clavesSinCampo(
  cuerpo: string,
  nombresPersistidos: Record<string, string>,
): Array<{ clave: string; etiqueta: string; retirada: boolean }> {
  return extraerVariables(cuerpo)
    .filter((clave) => !CAMPOS_PLANTILLA_POR_CLAVE.has(clave))
    .map((clave) => {
      const persistido = nombresPersistidos[clave];
      return {
        clave,
        etiqueta: persistido !== undefined ? persistido : clave,
        retirada: persistido !== undefined,
      };
    });
}
