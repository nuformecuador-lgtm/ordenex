// Feature 192 (F2.2/F2.3/F5.1/F5.2) + Feature 258 (F1.2/F5.2) — los ocho contadores de "en
// que termino el dia", repartidos en DOS grupos visualmente separados (R4/R28):
//
//   1. RESULTADOS  — los cinco desenlaces del enum `gestion_resultado`.
//   2. SIN RESULTADO — `sinRecoger` / `enReparto` / `otros`: todavia NO terminaron, y por
//      eso no se mezclan con los de arriba. Un pendiente no es un desenlace.
//
// Componente PURO: recibe los conteos por props. Lo comparten la tarjeta de un mensajero
// (`MensajeroCard`) y el bloque de totales (`TableroDiaTotales`), para que la tarjeta y el
// total no puedan pintar dos desgloses distintos del mismo dato (R30 de la 192).
//
// ─── FEATURE 258: CADA CONTADOR ES UN `Badge` (R15–R17) ───────────────────────────────────
// Ya no es un `div` con `bg-muted/40`: es la primitiva del repo, con su variante semantica
// sacada de `VARIANTE_CONTADOR`. Los anclajes NO se mueven: `Badge` es un `span` con
// `mergeProps`, asi que `data-contador`, el `title` de la ayuda del cubo y el texto
// (etiqueta + valor) siguen exactamente donde estaban.
//
// ─── LA ETIQUETA NO DESAPARECE NUNCA DEL NOMBRE ACCESIBLE (R45) ──────────────────────────
// En densidad compacta la etiqueta deja de VERSE, pero sigue en el DOM en `sr-only`: el
// nombre accesible del contador sigue diciendo «Entregadas 18» en las dos densidades. Un
// contador que en compacta solo dijera «18» seria un numero sin sujeto para quien escucha.

import { Badge } from "@/components/ui/badge";
import type { TotalesTableroDia } from "@/lib/types/tablero-dia";
import { cn } from "@/lib/utils";

import { ComposicionBarra } from "./ComposicionBarra";
import {
  ayudaBucket,
  CLAVES_BUCKET,
  CLAVES_RESULTADO,
  ETIQUETA_BUCKET,
  ETIQUETA_RESULTADO,
  VARIANTE_CONTADOR,
  type ClaveContador,
} from "./contadores";
import { DENSIDAD_INICIAL, type DensidadTablero } from "./densidad";

const TITULO_RESULTADOS = "Resultados del día";
const TITULO_SIN_RESULTADO = "Sin resultado todavía";

/**
 * ⚠️ TRES DEFECTOS ENCADENADOS, Y POR QUE LA FORMA ES ESTA
 *
 * Los tres se vieron en la app con datos reales y NINGUNO lo cazaba la suite. Se cuentan en
 * orden porque cada arreglo destapo el siguiente:
 *
 * 1. **La cifra quedaba fuera de la caja.** Etiqueta y cifra iban EN LINEA dentro del `Badge`,
 *    que es `overflow-hidden` + `whitespace-nowrap` y aqui va a `w-full`. Sin decir quien
 *    absorbe la falta de sitio, los dos hijos se salen y el navegador recorta por la derecha:
 *    el que desaparecia era la CIFRA. Medido: viewport 1440, chip de 109 px, «Reprogramadas 1»
 *    con `scrollWidth > clientWidth`.
 *    NO LO VIO NINGUN TEST: el `1` seguia en el DOM, asi que `toHaveTextContent("1")` pasaba.
 * 2. **`truncate` dejaba «Reprograma…».** Salvaba la cifra escondiendo letras. Decision del
 *    humano: la etiqueta ENTERA y la cifra, las dos legibles.
 * 3. **`break-words` partia la palabra por dentro** («Reprogramad / as»). Evita el recorte,
 *    pero una palabra rota no es la etiqueta completa. Y OJO: **este defecto pasaba el test de
 *    recorte**, porque una palabra partida NO desborda — cabe, rompiendose.
 *
 * ── LA FORMA QUE CUMPLE LAS TRES COSAS A LA VEZ
 *
 * En densidad COMODA el contador es de DOS LINEAS —etiqueta arriba, cifra debajo, como en la
 * feature 192— pero DENTRO del `Badge`, que es lo que aporta el color semantico (R15). Puestas
 * una sobre otra dejan de disputarse el ancho.
 *
 *   · la cifra    -> `shrink-0`: no encoge y no se recorta. Nunca.
 *   · la etiqueta -> `w-full leading-tight`, y NADA MAS: sin `truncate` (esconderia letras) y
 *     sin `break-words` (partiria la palabra). Con `overflow-wrap` en su valor por defecto, el
 *     navegador solo puede cortar ENTRE palabras: «Sin recoger» puede bajar de linea, pero
 *     «Reprogramadas» no se parte jamas.
 *   · la CAJA     -> tiene que ser bastante ancha, porque es lo unico que queda impidiendo que
 *     la palabra se salga. Y eso NO se puede fiar al viewport: la misma pantalla de 768 px da
 *     una tarjeta de 189 px —donde solo cabe UNA columna— y una tira de 700, donde caben tres.
 *     Por eso las columnas se deciden con umbrales de CONTENEDOR (`@container` + `@[...]`),
 *     contra el ancho real de la caja que los contiene.
 *
 * Los umbrales salen de una MEDICION en el navegador, no de una estimacion: «Reprogramadas»
 * pide 99,6 px y «recoger» 47 px con la fuente y el tamaño reales. De ahi los 16rem/26rem de
 * los cinco desenlaces y los 9rem/13rem de los tres cubos, con holgura. La tabla completa esta
 * en `progress/impl_258_frontend.md`.
 *
 * En densidad COMPACTA la etiqueta sale de la VISTA (`sr-only`, sigue en el nombre accesible,
 * R45) y el chip vuelve a una linea: sin etiqueta visible no hay nada que pueda empujar a la
 * cifra ni ninguna palabra que partir.
 *
 * ── LO QUE ESTO PISA DEL DISENO, DICHO Y NO ESCONDIDO
 * `design.md` §11.3 preveia el choque y decia que, si no cabia, «la salida es la densidad, no
 * un `className` que pise la altura de la primitiva». Aqui se pisa: `h-auto` sobre el `h-5` del
 * `Badge`. Es una decision HUMANA posterior y explicita, tomada tras ver la pantalla con datos
 * reales; la salida por densidad se descarto porque obligaba a elegir entre leer la etiqueta y
 * ver los ocho contadores a la vez.
 *
 * ⛔ No le quites el `shrink-0` a la cifra, no le metas `truncate` ni `break-words` a la
 * etiqueta, y no cambies los umbrales por breakpoints de viewport. Lo fija
 * `TableroDiaTarjetas.test.tsx` › «la etiqueta se lee ENTERA y la cifra no se recorta nunca».
 */
function Contador({
  clave,
  etiqueta,
  valor,
  ayuda,
  densidad,
}: Readonly<{
  clave: ClaveContador;
  etiqueta: string;
  valor: number;
  ayuda?: string;
  densidad: DensidadTablero;
}>) {
  const compacta = densidad === "compacta";

  return (
    <Badge
      variant={VARIANTE_CONTADOR[clave]}
      data-contador={clave}
      // Los tres cubos conservan su ayuda EXACTA (`ayudaBucket`, contrato de la 192); los
      // cinco desenlaces, que antes no tenian `title`, ganan el texto completo.
      title={ayuda ?? `${etiqueta} ${valor}`}
      className={cn(
        "w-full",
        compacta
          ? "justify-center gap-1 px-1.5"
          : // `h-auto` es lo que deja crecer la caja a dos lineas; `whitespace-normal` es lo
            // que permite que la etiqueta se envuelva en vez de salirse.
            "h-auto flex-col items-start justify-start gap-0 rounded-md px-2 py-1 whitespace-normal",
      )}
    >
      {/* R45 — en compacta la etiqueta sale de la VISTA, no del nombre accesible. */}
      <span
        data-parte="etiqueta"
        className={cn(compacta ? "sr-only" : "w-full leading-tight")}
      >
        {etiqueta}
      </span>
      <span
        data-parte="valor"
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          !compacta && "text-sm leading-tight",
        )}
      >
        {valor}
      </span>
    </Badge>
  );
}

export interface ContadoresTableroProps {
  readonly contadores: TotalesTableroDia;
  /** R44/R45 — solo cambia la FORMA de los chips; ninguna cifra y ningun orden. */
  readonly densidad?: DensidadTablero;
  /**
   * De quien habla la barra de composicion, para su nombre accesible. Sin ella no se pinta
   * barra: la monta quien sabe si es «del día» o «de Ana Rojas» (R66/R68).
   */
  readonly etiquetaComposicion?: string;
}

export function ContadoresTablero({
  contadores,
  densidad = DENSIDAD_INICIAL,
  etiquetaComposicion,
}: ContadoresTableroProps) {
  const compacta = densidad === "compacta";

  return (
    <div className={cn("@container flex flex-col", compacta ? "gap-2" : "gap-3")}>
      {/* R66 — la barra apilada, con el MISMO dato que los ocho chips de abajo (R69). */}
      {etiquetaComposicion ? (
        <ComposicionBarra contadores={contadores} etiqueta={etiquetaComposicion} />
      ) : null}

      <section data-grupo="resultados" aria-label={TITULO_RESULTADOS}>
        <h4 className="mb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          {TITULO_RESULTADOS}
        </h4>
        <div
          className={cn(
            "grid gap-1.5",
            compacta
              ? "grid-cols-5"
              : // Umbrales medidos, no estimados (ver la cabecera): por debajo de 16rem la
                // caja no da para «Reprogramadas» en dos columnas, asi que baja a una.
                "grid-cols-1 @[16rem]:grid-cols-2 @[26rem]:grid-cols-3",
          )}
        >
          {CLAVES_RESULTADO.map((clave) => (
            <Contador
              key={clave}
              clave={clave}
              etiqueta={ETIQUETA_RESULTADO[clave]}
              valor={contadores[clave]}
              densidad={densidad}
            />
          ))}
        </div>
      </section>

      {/* R4/R28 — separacion VISUAL (no solo de orden) entre lo que termino y lo que no:
          borde superior + su propio titulo. */}
      <section
        data-grupo="sin-resultado"
        aria-label={TITULO_SIN_RESULTADO}
        className={cn("border-t border-foreground/10", compacta ? "pt-2" : "pt-3")}
      >
        <h4 className="mb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          {TITULO_SIN_RESULTADO}
        </h4>
        <div
          className={cn(
            "grid gap-1.5",
            compacta
              ? "grid-cols-3"
              : // Mismo criterio que arriba con sus propios umbrales: la palabra mas larga de
                // los tres cubos es «recoger» (47 px medidos), asi que piden mucha menos caja
                // que «Reprogramadas» (99,6 px) y caben en tres columnas mucho antes.
                "grid-cols-1 @[9rem]:grid-cols-2 @[13rem]:grid-cols-3",
          )}
        >
          {/* R5/R45 — los TRES cubos se pintan siempre, `otros` incluido aunque valga 0, y
              cada uno lleva la ayuda que explica que contiene. */}
          {CLAVES_BUCKET.map((clave) => (
            <Contador
              key={clave}
              clave={clave}
              etiqueta={ETIQUETA_BUCKET[clave]}
              valor={contadores[clave]}
              ayuda={ayudaBucket(clave)}
              densidad={densidad}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
