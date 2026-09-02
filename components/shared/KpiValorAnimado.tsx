"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import CountUp from "react-countup";

import { ESCALA_PRESENTACION, formatMonto, monedaConfig } from "@/lib/config/moneda";
import { cn } from "@/lib/utils";
import { toValidNumber } from "@/lib/utils/number";

// Valor numérico de un KPI, animado de 0 al valor final con react-countup. Es
// client component (la animación necesita el navegador); el KPI en sí sigue
// siendo server-compatible y solo monta esta hoja. Nació en el portal del
// mensajero (feature 61) y vive acá desde que también lo usan los cierres.

// La moneda (símbolo, código y locale) NO se escribe aquí: se resuelve por
// configuración en `lib/config/moneda.ts`, como pide `docs/architecture.md`
// («sin hardcode de contexto»). Hasta la feature 130 este archivo tenía un
// `const SIMBOLO = "₡"` y un `"es-CR"` incrustados, así que cambiar de país
// obligaba a editar un componente compartido. El formato resultante es el de
// `formatMonto`, el mismo que ya usan los otros cinco consumidores cliente. Fue
// el de `Intl` con `style: "currency"` —que agrupa los miles con espacio duro—
// hasta que la feature 201 unifico la agrupacion en `lib/config/moneda.ts`, y
// desde la ficha 359 ese formato lleva la cola SOLO CUANDO EXISTE: «₡3.500», «₡416,47».
//
// Lo que este arreglo NO resuelve, y es PREEXISTENTE (no lo introduce la 130):
// `loadMonedaConfig` lee `process.env[name]` con clave dinámica, y Next solo
// inlinea `NEXT_PUBLIC_*` con acceso estático, así que en el navegador la
// configuración cae a su default `es-CR`/`CRC`. Ya les pasa a `EtiquetaGuia`,
// `ChatConversacion`, `PosOrderCardDetalle`, `PosOrderCardMosaico` y
// `SateliteOrderCard`; este KPI es el sexto, no el primero. Hacerla configurable
// en cliente es una ficha propia sobre `lib/config/moneda.ts`.

// Piezas del detector de hidratacion (ver `arrancarEnCero`). Son constantes de MODULO a
// proposito: `useSyncExternalStore` compara identidades y unas funciones recreadas en cada
// render lo harian resuscribirse sin necesidad. Aqui no hay nada externo a lo que suscribirse
// —el valor cambia una sola vez, al hidratar—, asi que la baja no hace nada.
const sinSuscripcion = () => () => {};
const enCliente = () => true;
const enServidor = () => false;

// --- `prefers-reduced-motion` (2026-08-19) --------------------------------
//
// Se añadió al montar este contador en los KPI de analítica, que es donde estaba escrito el
// requisito: R28 de la 130 prohíbe animar a quien pidió menos movimiento, y la cabecera de
// `KpiCard` decía justamente que animar exigía enseñarle esto al componente compartido antes.
//
// Va aquí y no en una clase CSS porque esta animación NO es CSS: la cuenta la lleva
// `react-countup` con `requestAnimationFrame`, y la regla `@media (prefers-reduced-motion)` de
// `globals.css` no puede detener JavaScript. Quien pidió menos movimiento ve la cifra FINAL
// puesta de una vez — nunca un cero congelado, que sería perder el dato en vez de la animación.
//
// Se SUSCRIBE al cambio (no se lee una vez) para que cambiar el ajuste del sistema con la
// pantalla abierta surta efecto sin recargar. Las tres funciones son de módulo por la misma
// razón que las de arriba: `useSyncExternalStore` compara identidades.
const CONSULTA_MOVIMIENTO = "(prefers-reduced-motion: reduce)";

function suscribirAMovimiento(alCambiar: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const consulta = window.matchMedia(CONSULTA_MOVIMIENTO);
  consulta.addEventListener("change", alCambiar);
  return () => consulta.removeEventListener("change", alCambiar);
}

const menosMovimientoEnCliente = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(CONSULTA_MOVIMIENTO).matches;

/** En el servidor no hay preferencia que consultar: se anima, y el cliente corrige si toca. */
const menosMovimientoEnServidor = () => false;

export interface KpiValorAnimadoProps {
  value?: string | number | null;
  /** Formatea como monto con la moneda configurada (`lib/config/moneda.ts`). */
  moneda?: boolean;
  /**
   * Texto pegado delante del numero, DENTRO del formateo (feature 198: el `+` de las cifras
   * aproximadas de la landing). Va aqui y no como hermano en el JSX para que acompañe al
   * numero durante toda la animacion en vez de aparecer suelto al lado de un 0 que sube.
   */
  prefijo?: string;
  /**
   * Arranca la cuenta cuando el elemento ENTRA EN PANTALLA, no al montar (feature 198, banda
   * de la landing: esta por debajo del pliegue y animar a ciegas gastaria el efecto antes de
   * que nadie lo vea).
   *
   * ⛔ NO se usa el `enableScrollSpy` de countup.js, y se probo: react-countup construye la
   * instancia DURANTE EL RENDER para calcular el texto inicial, cuando su `ref` todavia es
   * `null`. countup.js acepta ese target nulo en silencio salvo con el scroll spy encendido,
   * que ademas de imprimir
   *     [CountUp] target is null or undefined null
   * en la consola se queda SIN observer, y react-countup cachea esa instancia rota. El efecto
   * de montaje la recrea al llamar a `start()`, asi que la cifra acaba animandose igual —pero
   * de inmediato y estando fuera de pantalla, que es justo lo contrario de lo que se pedia—.
   * El observador se monta aqui, despues del render, con el elemento ya en el DOM.
   *
   * Por defecto `false`: los KPI del portal y de los cierres se montan ya visibles y cambiar
   * su arranque seria una regresion silenciosa.
   */
  animarAlSerVisible?: boolean;
  /**
   * Fuerza que el PRIMER render —el HTML de servidor y la hidratacion— muestre 0 y que el
   * contador solo se monte despues (feature 198: «cuenta animada con default 0»).
   *
   * Hace falta porque `start={0}` NO basta, aunque el comentario de abajo lo diera por hecho:
   * react-countup 6.5.3 emite el valor FINAL en el HTML inicial y solo baja a `start` al
   * hidratarse, asi que la cifra aparece puesta y despues salta a 0 para subir. Verificado con
   * `renderToStaticMarkup`.
   *
   * Por defecto `false`, y no por prudencia sino porque para los KPI de dinero seria una
   * REGRESION: hoy su valor real viaja en el HTML y sobrevive aunque el JS no llegue; con esto
   * activado, sin JS se quedarian en un 0 que parece un saldo. En la landing ese riesgo no
   * existe —son cifras de marca, no un saldo— y el arranque limpio si se nota.
   */
  arrancarEnCero?: boolean;
  /**
   * Formateo PROPIO de cada fotograma, para cifras que no son ni un monto ni un entero pelado
   * (2026-08-19: los KPI de analítica, cuyo texto lo decide la UNIDAD de la métrica —«45 %»,
   * «2,3 h»— vía `formatearValor`).
   *
   * Gana sobre `moneda` y `prefijo`: quien pasa su formateador lo pasa entero.
   *
   * ⚠ MEMOIZALA en el llamador (`useCallback`). `react-countup` reinicia la cuenta desde
   * `start` en un efecto que depende de la IDENTIDAD de `formattingFn`, así que una función
   * recreada en cada render relanza la animación con cualquier re-render del padre.
   */
  formatear?: (n: number) => string;
  /**
   * RESOLUCION de la cuenta: cuantos decimales conserva el valor de CADA FOTOGRAMA. No decide
   * el texto —de eso se ocupa `formatear`—, decide cuantos pasos distintos hay entre 0 y el
   * final.
   *
   * Existe porque countup.js redondea `frameVal` a `decimalPlaces` ANTES de formatearlo
   * (`countUp.js:73`), asi que con el 0 de siempre una cifra que vive ENTRE 0 y 1 —un
   * porcentaje que llega como fraccion— no cuenta: todos sus fotogramas redondean a 0 y la
   * tarjeta salta del 0 % al 84,2 % de una vez. Con `decimales={3}` esa misma cuenta tiene
   * cientos de pasos y se ve subir.
   *
   * Por defecto `0`, que es el comportamiento de siempre para conteos y magnitudes grandes.
   *
   * ⛔ EN MODO MONEDA SE IGNORA y se fuerza a `ESCALA_PRESENTACION`. La 230 lo forzaba a 0
   * porque entonces el texto del dinero se cuadraba al colon y recalcular centimos por
   * fotograma era trabajo invisible; con la ficha 359 el texto SI los lleva cuando existen, y
   * countup.js cuadra `frameVal` a `decimalPlaces` ANTES de pasarlo al formateador — incluido
   * el ULTIMO fotograma. Dejarlo en 0 haria que un KPI animado aterrizara en `₡13.331.833`
   * mientras la misma cifra se lee `₡13.331.832,72` en la tabla de al lado, que es exactamente
   * la contradiccion que la 359 vino a matar. Que esta puerta no pueda desalinearlo del
   * formateador es a proposito.
   */
  decimales?: number;
  className?: string;
}

export function KpiValorAnimado({
  value,
  moneda = false,
  prefijo = "",
  animarAlSerVisible = false,
  arrancarEnCero = false,
  formatear: formatearPropio,
  decimales = 0,
  className,
}: Readonly<KpiValorAnimadoProps>) {
  const amount = toValidNumber(value);
  // Ficha 359 (antes 230/R14): en modo moneda los decimales del CONTADOR son los de la escala
  // de presentacion, no cero. El texto lo pinta `formatear` —que en moneda es `formatMonto`—,
  // pero `decimals` gobierna el valor de cada fotograma INCLUIDO EL ULTIMO, asi que con 0 el
  // KPI aterrizaba en la cifra cuadrada al colon y contradecia a la tabla de al lado. El
  // numero sale de `lib/config/moneda.ts` y no se escribe aqui: son la misma decision.
  //
  // Fuera del dinero manda `decimales`, que por defecto sigue siendo 0: lo unico que cambia
  // es que ahora una cifra menor que 1 puede pedir la resolucion que su cuenta necesita (ver
  // la prop). Se sanea aqui —entero y no negativo— porque countup.js lo pasa tal cual a
  // `toFixed`, que revienta con un valor absurdo.
  const decimals = moneda ? ESCALA_PRESENTACION : Math.max(0, Math.trunc(decimales));

  // `false` en el servidor y durante la hidratacion, `true` en cuanto corre en el navegador.
  // Va con `useSyncExternalStore` y no con un `useState` + `useEffect`: React usa el snapshot
  // de servidor tambien para el render de hidratacion, asi que no hay desajuste, y ademas es
  // lo que exige la regla `react-hooks/set-state-in-effect` (un setState en un efecto vacio
  // dispara un render en cascada).
  const hidratado = useSyncExternalStore(sinSuscripcion, enCliente, enServidor);
  const montado = !arrancarEnCero || hidratado;

  // Puerta de visibilidad (`animarAlSerVisible`). El ancla va SIEMPRE en el envoltorio, que es
  // el mismo elemento antes y despues de que entre el contador: si el ref saltara de un nodo a
  // otro al cambiar de rama, el observador se quedaria mirando un nodo ya desmontado.
  const ancla = useRef<HTMLSpanElement>(null);
  const [visto, setVisto] = useState(false);

  useEffect(() => {
    if (!animarAlSerVisible || visto) return;
    const el = ancla.current;
    // Sin `IntersectionObserver` no se espera a nada: mas vale animar de mas que dejar la
    // cifra congelada en 0. Ese caso se resuelve en el render (`sinObservador`), no aqui,
    // porque un `setVisto` sincrono en el cuerpo del efecto encadena renders.
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) setVisto(true);
    });
    observador.observe(el);

    return () => observador.disconnect();
  }, [animarAlSerVisible, visto]);

  // Se consulta `IntersectionObserver` solo despues de hidratar: mirarlo durante el render de
  // servidor daria `undefined` siempre y el HTML no coincidiria con el del navegador.
  const sinObservador = hidratado && typeof IntersectionObserver === "undefined";
  const enPantalla = !animarAlSerVisible || visto || sinObservador;

  // MEMOIZADA A PROPÓSITO: react-countup reinicia la animación desde `start` en un
  // efecto que depende de la IDENTIDAD de `formattingFn`. Si se recreara en cada
  // render, cualquier re-render del padre (abrir el detalle de un cierre, por
  // ejemplo) relanzaría el conteo desde 0. `moneda` y `prefijo` son los únicos valores
  // reactivos que la función lee (`formatMonto` y `monedaConfig` son de módulo), así
  // que el formato sigue correcto.
  const formatearPorDefecto = useCallback(
    (n: number) =>
      prefijo +
      (moneda
        ? formatMonto(n)
        : new Intl.NumberFormat(monedaConfig.locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(n)),
    [moneda, prefijo],
  );
  const formatear = formatearPropio ?? formatearPorDefecto;

  // Quien pidió menos movimiento no ve la cuenta: ve el valor final, ya formateado, desde el
  // primer fotograma. No se toca ninguna otra rama —ni el arranque en cero, ni la puerta de
  // visibilidad— porque aquéllas deciden CUÁNDO animar y ésta decide SI se anima.
  const menosMovimiento = useSyncExternalStore(
    suscribirAMovimiento,
    menosMovimientoEnCliente,
    menosMovimientoEnServidor,
  );

  // El envoltorio es SIEMPRE el mismo nodo, con las mismas clases, esté o no el contador
  // dentro: así el hueco no cambia de tamaño al entrar y el ancla del observador no se mueve.
  return (
    <span ref={ancla} className={cn("tabular-nums whitespace-nowrap", className)}>
      {menosMovimiento ? (
        formatear(amount)
      ) : montado && enPantalla ? (
        /* start=0: la animación sube desde ahí una vez montado el contador. Ojo, `start` NO
           gobierna el HTML inicial —react-countup emite ahí el valor final—; de eso se
           ocupa `arrancarEnCero`. */
        <CountUp
          start={0}
          end={amount}
          duration={1.2}
          decimals={decimals}
          formattingFn={formatear}
          preserveValue
        />
      ) : (
        formatear(0)
      )}
    </span>
  );
}
