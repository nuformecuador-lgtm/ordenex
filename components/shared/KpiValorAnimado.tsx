"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import CountUp from "react-countup";

import { formatMonto, monedaConfig } from "@/lib/config/moneda";
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
// el de `Intl` con `style: "currency"` («₡3 500,00», con espacio duro) hasta que
// la feature 201 unifico la agrupacion en `lib/config/moneda.ts` («₡3.500,00»).
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
  className?: string;
}

export function KpiValorAnimado({
  value,
  moneda = false,
  prefijo = "",
  animarAlSerVisible = false,
  arrancarEnCero = false,
  className,
}: Readonly<KpiValorAnimadoProps>) {
  const amount = toValidNumber(value);
  const decimals = moneda ? 2 : 0;

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
  const formatear = useCallback(
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

  // El envoltorio es SIEMPRE el mismo nodo, con las mismas clases, esté o no el contador
  // dentro: así el hueco no cambia de tamaño al entrar y el ancla del observador no se mueve.
  return (
    <span ref={ancla} className={cn("tabular-nums whitespace-nowrap", className)}>
      {montado && enPantalla ? (
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
