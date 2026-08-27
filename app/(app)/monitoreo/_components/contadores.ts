// Feature 192 (F5.1/F5.2) — ETIQUETAS VISIBLES de los ocho contadores del tablero del dia.
//
// Viven JUNTO al componente que las pinta (`MensajeroCard`) y no en `lib/`: son texto de
// presentacion, no dominio. El dominio (los buckets y su clasificacion) sigue estando en
// `lib/types/tablero-dia.ts`, que es de donde se DERIVAN las claves de aqui.
//
// R48 — aqui NO hay ningun mapa de estatus -> etiqueta ni ningun color de estatus: el
// vocabulario visual del estatus se importa de `EstatusBadge`/`estatusLabel` del listado de
// ordenes. Lo unico que se declara son las etiquetas de los CONTADORES, que no existen en
// ninguna otra parte del arbol.

import type { GestionResultado } from "@prisma/client";
import type { ComponentProps } from "react";

import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { Badge } from "@/components/ui/badge";
import {
  estatusDelBucket,
  type BucketSinResultado,
  type FilaTableroDia,
} from "@/lib/types/tablero-dia";

/**
 * Clave del contador de cada resultado del dia. Se DERIVA del enum `GestionResultado`
 * (`entregada` -> `entregadas`), asi que un sexto valor del enum deja de compilar aqui en
 * vez de quedarse sin etiqueta en silencio (R24/R27).
 */
export type ClaveResultado = `${GestionResultado}s`;

/**
 * Comprobacion tipada de que cada clave derivada del enum ES un contador de la fila: si el
 * contrato de `FilaTableroDia` renombrara uno, esto deja de compilar.
 */
type _ClavesSonContadores = ClaveResultado extends keyof FilaTableroDia ? true : never;
const _clavesSonContadores: _ClavesSonContadores = true;
void _clavesSonContadores;

/** R24 — los cinco resultados del dia. `Record` EXHAUSTIVO: falta una y no compila. */
export const ETIQUETA_RESULTADO = {
  entregadas: "Entregadas",
  reprogramadas: "Reprogramadas",
  devueltas: "Devueltas",
  rechazadas: "Rechazadas",
  incidentes: "Incidentes",
} as const satisfies Record<ClaveResultado, string>;

/** Orden de pintado de los cinco resultados (el del enum, de mejor a peor desenlace). */
export const CLAVES_RESULTADO = [
  "entregadas",
  "reprogramadas",
  "devueltas",
  "rechazadas",
  "incidentes",
] as const satisfies readonly ClaveResultado[];

/**
 * F5.1 — etiquetas de los tres buckets de "sin resultado", derivadas del tipo
 * `BucketSinResultado` con un `Record` EXHAUSTIVO: un bucket nuevo no compila sin etiqueta.
 */
export const ETIQUETA_BUCKET = {
  sinRecoger: "Sin recoger",
  enReparto: "En reparto",
  otros: "Otros",
} as const satisfies Record<BucketSinResultado, string>;

/** Orden de pintado de los tres buckets: del que no arranco al cajon de sastre. */
export const CLAVES_BUCKET = [
  "sinRecoger",
  "enReparto",
  "otros",
] as const satisfies readonly BucketSinResultado[];

/** Que significa cada bucket, en una linea. Se muestra como ayuda del contador. */
const SIGNIFICADO_BUCKET = {
  sinRecoger: "Sin gestión de hoy: el mensajero todavía no arrancó con ellas",
  enReparto: "Sin gestión de hoy: ya las recogió y está en la calle",
  // R45 — `otros` se pinta SIEMPRE, aunque valga 0, y con ayuda: es el bucket que delata
  // que el mapa se quedo corto. Esconderlo haria que un cambio de flujo pasara desapercibido.
  otros: "Sin gestión de hoy y en cualquier otro estatus",
} as const satisfies Record<BucketSinResultado, string>;

/**
 * R45 — ayuda de un bucket: su significado MAS la lista de estatus que contiene, derivada
 * de `estatusDelBucket` (nunca escrita a mano: una lista paralela es justo lo que R46
 * persigue) y traducida con el `estatusLabel` del listado de ordenes (R48).
 */
export function ayudaBucket(bucket: BucketSinResultado): string {
  const estatus = estatusDelBucket(bucket).map(estatusLabel).join(", ");
  return `${SIGNIFICADO_BUCKET[bucket]}. Estatus: ${estatus}.`;
}

/* -------------------------------------------------------------------------- */
/* Feature 258 (F1.1/F5.1) — el VOCABULARIO VISUAL de los ocho contadores      */
/* -------------------------------------------------------------------------- */

/**
 * Las OCHO claves de contador, en el orden en que se pintan: los cinco desenlaces y
 * despues los tres cubos. Una sola lista para la barra de composicion y para su nombre
 * accesible, derivada de las dos que ya existian.
 */
export type ClaveContador = ClaveResultado | BucketSinResultado;

export const CLAVES_CONTADOR = [
  ...CLAVES_RESULTADO,
  ...CLAVES_BUCKET,
] as const satisfies readonly ClaveContador[];

/** La etiqueta visible de cualquiera de los ocho, sin que el llamador sepa de que grupo es. */
export function etiquetaContador(clave: ClaveContador): string {
  return clave in ETIQUETA_RESULTADO
    ? ETIQUETA_RESULTADO[clave as ClaveResultado]
    : ETIQUETA_BUCKET[clave as BucketSinResultado];
}

/**
 * La variante sale del PROPIO componente (`ComponentProps<typeof Badge>`), no de
 * `VariantProps<typeof badgeVariants>`: el identificador literal `badgeVariants` esta
 * censado por `frontera.guardia.test.ts` (R18) y nombrarlo aqui pondria el guardia rojo.
 */
type VarianteContador = NonNullable<ComponentProps<typeof Badge>["variant"]>;

/**
 * R15/R16/R17 — la variante semantica de cada contador. UNA sola declaracion en el arbol.
 *
 * ⚠️ CLAVADO POR CLAVE DE CONTADOR (`entregadas`), NUNCA por value del catalogo de estatus
 * ni de `gestion_resultado` (`entregada`). No es estilo: el censo de la clausula (f) de
 * `frontera.guardia.test.ts` solo se dispara cuando la CLAVE es un value de
 * `ORDER_STATUS_SEED`, asi que el par `entregada: "success"` seria un segundo mapa de color
 * de estatus y el guardia se pondria rojo — con razon.
 *
 * ── FEATURE 292: LA TARJETA LLEVA EL COLOR DE **SU** SEGMENTO
 * Esta tabla y `COLOR_SEGMENTO` son dos declaraciones del MISMO vocabulario visual, y hasta
 * la 292 discrepaban en cuatro de los ocho: `devueltas` era violeta en la barra y ambar en la
 * tarjeta, `incidentes` teja y rojo, `sinRecoger` pizarra y gris, `enReparto` azul marino y
 * azul claro. Quien miraba la barra no podia leerla desde las tarjetas, que es lo unico que
 * lleva la cifra: el color dejaba de ser un puente entre las dos y pasaba a ser ruido.
 *
 * Lo que cambia es la MITAD que discrepaba. Los cuatro que ya concordaban de familia se
 * quedan exactamente como estaban (`entregadas`, `reprogramadas`, `rechazadas`, y `otros` sin
 * acento por ser el cajon de sastre). Y la barra NO se toca: sus ocho colores son los que
 * distinguen ocho categorias, y hacerla semantica juntaria `devueltas` con `reprogramadas` e
 * `incidentes` con `rechazadas` — dos pares indistinguibles justo en la pieza cuyo trabajo es
 * distinguirlos (decision humana del 2026-08-27, se descarto tambien el punto de color).
 *
 * ── LO QUE ESTO REEMPLAZA, dicho y no escondido
 * La 258 escribio aqui que «el color codifica GRAVEDAD, no identidad», y por eso `devueltas`
 * compartia ambar con `reprogramadas` e `incidentes` rojo con `rechazadas`. Ese criterio
 * queda RETIRADO para los cuatro que la barra pinta con `--chart-*`: en esta pantalla el color
 * codifica **la misma categoria que la barra**, y la gravedad la sigue diciendo el grupo
 * («Resultados del dia» / «Sin resultado todavia») ademas de la etiqueta y la cifra, que van
 * DENTRO del mismo `Badge` y son las que portan el dato (R68).
 *
 * El coste que ese criterio evitaba era real y esta pagado: los `--chart-*` eran colores
 * PLANOS y una variante de `Badge` necesita un PAR (`-soft` de fondo + `-strong` de texto). La
 * 292 los crea en `app/globals.css` con sus ocho contrastes medidos en los dos temas.
 *
 * ⚠️ EL NOMBRE DE LA VARIANTE ES EL DEL TOKEN DE SU SEGMENTO (`bg-chart-6` -> `chart6`). No es
 * cosmetica: es lo que deja comprobar la concordancia sin una tercera tabla que se desincronice
 * como se desincronizaron estas dos. Lo ata `tests/unit/tablero-dia/color-contador.guardia.test.ts`,
 * que compara los colores REALES que salen de las dos tablas, contador a contador.
 *
 * `satisfies Record<...>` EXHAUSTIVO: un sexto resultado o un cuarto cubo NO COMPILA sin
 * variante asignada (R16).
 */
export const VARIANTE_CONTADOR = {
  entregadas: "success",
  reprogramadas: "warning",
  devueltas: "chart6",
  rechazadas: "danger",
  incidentes: "chart11",
  sinRecoger: "chart12",
  enReparto: "chart13",
  otros: "outline",
} as const satisfies Record<ClaveContador, VarianteContador>;

/**
 * R67 — el color de cada segmento de la barra de composicion. Misma regla de clavado que
 * `VARIANTE_CONTADOR`: por clave de contador, jamas por value de estatus.
 *
 * ── POR QUE ESTOS TOKENS Y NO OTROS
 * - La BASE semantica es el rol correcto para una barra: `DESIGN.md` dice literalmente que
 *   la base es «borde, acento y punto de estado (dot, icono, barra)». El `-soft` es fondo de
 *   chip y el `-strong` es texto; ninguno pinta un segmento.
 * - Los tres contadores SIN semantico propio van a `--chart-*`, que GIRAN con el tema
 *   (se declaran en `:root` y se redefinen en `.dark`/`.tema-sistema`). Son los mismos tres
 *   colores de la maqueta, ya tokenizados: `chart-6` el morado, `chart-11` el marron y
 *   `chart-12` el gris. No se inventa ninguna paleta.
 * - `otros` va sin acento: es el cajon de sastre, y `DESIGN.md` reserva la saturacion para
 *   accion y estado.
 *
 * ⚠️ `enReparto` NO va en `bg-info`, y no es un descuido — es la salida que `design.md` §11.6
 * dejo escrita y F7.3 mandaba comprobar. `--color-info` (`#1a56db`) es un hex FIJO y oscuro y
 * la pista `bg-muted` gira: medido con `tests/fixtures/contraste.ts` sobre los tokens reales
 * de `app/globals.css`, ese par da **2.34:1 en tema oscuro**, por debajo del 3:1 que WCAG
 * 1.4.11 pide a un objeto grafico. `chart-13` gira (`#1e3a8a` claro / `#93c5fd` oscuro) y da
 * **9.41 / 8.03**. Lo fija un test: `TableroDiaComposicion.test.tsx` › «se separa de la pista
 * en los DOS temas». **Nunca un hex nuevo.**
 *
 * ⛔ Ni un hex, ni una utilidad de paleta cruda de Tailwind (R46).
 *
 * ── FEATURE 292 — ESTA TABLA MANDA, Y LA DE ARRIBA LA SIGUE
 * Los ocho colores de aqui NO cambian: son los que distinguen ocho categorias. Lo que cambio
 * es `VARIANTE_CONTADOR`, que ahora toma de cada contador el color de SU segmento. Si mueves
 * un token de esta tabla, el `Badge` de esa tarjeta se queda con el color viejo y la barra
 * vuelve a ser ilegible desde las tarjetas: el par se mueve entero o no se mueve.
 */
export const COLOR_SEGMENTO = {
  entregadas: "bg-success",
  reprogramadas: "bg-warning",
  devueltas: "bg-chart-6",
  rechazadas: "bg-danger",
  incidentes: "bg-chart-11",
  sinRecoger: "bg-chart-12",
  enReparto: "bg-chart-13",
  otros: "bg-muted-foreground/40",
} as const satisfies Record<ClaveContador, string>;
