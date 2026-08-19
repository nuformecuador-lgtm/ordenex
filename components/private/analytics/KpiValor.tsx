"use client";

// La CIFRA de un KPI de analítica, animada (pedido humano 2026-08-19).
//
// Existe por una restricción concreta de la frontera RSC: `KpiValorAnimado` acepta el formateo
// de cada fotograma como FUNCIÓN, y una función no cruza de un Server Component a uno de
// cliente. `KpiCard` es server-compatible y hay que mantenerlo así, de modo que lo que viaja
// desde él son dos props serializables —el número y su unidad— y el formateador se construye
// aquí, ya en el cliente.
//
// El texto lo sigue decidiendo `formatearValor`, el MISMO de siempre: la animación cambia
// cuándo se ve la cifra, nunca cómo se escribe. Por eso no hay ningún formato copiado aquí y
// por eso el fotograma final es idéntico, carácter a carácter, al que se pintaba sin animar.
//
// El DATO AUSENTE no se anima, y no es un detalle: `formatearValor(null, …)` es el marcador de
// «no hay dato», y contar de 0 hasta él no significa nada. Un cero subiendo, además, se leería
// como una medición cuando lo que hay es un hueco (R11/R14 de la 130).
//
// `prefers-reduced-motion` lo respeta `KpiValorAnimado` (R28 de la 130): quien pidió menos
// movimiento ve la cifra final puesta de una vez, no un cero congelado.
//
// ─── POR QUÉ `arrancarEnCero` (pedido humano 2026-08-19) ─────────────────────────────────
//
// «Que la cuenta se vea subir desde 0, como en los KPI del mensajero y la landing». Sin esta
// puerta, react-countup 6.5.3 emite el valor FINAL en el HTML inicial y solo baja a `start`
// al hidratarse: la tarjeta enseña la cifra puesta, salta a 0 y sube. Eso no es una cuenta,
// es un parpadeo — y se ve exactamente en los KPI que SÍ traen su valor desde el servidor
// (el tablero financiero, pre-cargado en la ruta). Los de las otras regiones llegan por SWR:
// su primer HTML es el esqueleto, así que ya contaban desde 0 y aquí no cambian.
//
// LO QUE CUESTA, dicho sin adornos: `arrancarEnCero` está documentado como regresión para los
// KPI de dinero porque su valor real deja de viajar en el HTML y, sin JavaScript, la tarjeta
// se queda en un 0 que parece un saldo. Se asume AQUÍ y solo aquí porque `/analitica` no
// funciona sin JavaScript en ningún caso —sus regiones se piden por SWR y su barra de filtros
// es de cliente—, así que la propiedad que se pierde no la tenía esta pantalla. Los otros
// consumidores del contador compartido (portal del mensajero, cierres) NO pasan la puerta y
// conservan su valor sin JS: la decisión es de este envoltorio, no del componente compartido.

// ─── POR QUÉ HAY UNA RESOLUCIÓN POR UNIDAD (2026-08-19) ──────────────────────────────────
//
// «Los KPI de Movimiento de las órdenes no cuentan desde 0». Los cinco montaban ya el
// contador, pero los DOS de efectividad no se veían contar: su valor es una fracción (0,842)
// y countup.js redondea el valor de cada fotograma a `decimalPlaces` ANTES de pasarlo al
// formateador. Con los 0 decimales de siempre, todos los fotogramas de una cifra menor que 1
// valen 0 y la tarjeta salta del «0 %» al «84,2 %»: eso no es una cuenta, es un parpadeo.
// Por eso `DECIMALES_DE_LA_CUENTA`.

import { useCallback } from "react";

import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";

import { formatearValor } from "./formato";
import type { MetricaUnidad } from "./tipos";

/**
 * RESOLUCIÓN de la cuenta por unidad: cuántos decimales conserva cada fotograma.
 *
 * No cambia el TEXTO —lo escribe `formatearValor` igual que siempre—, cambia cuántos pasos
 * distintos hay entre 0 y el valor final. Hace falta porque countup.js redondea el valor de
 * cada fotograma antes de formatearlo, y un `porcentaje` llega como FRACCIÓN (0,842 = 84,2 %):
 * con 0 decimales todos sus fotogramas valen 0 y la tarjeta salta del «0 %» al «84,2 %» sin
 * contar nada. Tres decimales dan ~842 pasos, que a 1,2 s se ve subir; y son exactamente los
 * que `formatearPorcentaje` puede distinguir (un decimal DESPUÉS de multiplicar por 100).
 *
 * Las otras tres unidades se quedan en 0 y no por descuido: sus valores son magnitudes
 * grandes —conteos de órdenes, segundos de ciclo, colones— y ya tienen pasos de sobra. Pedir
 * decimales ahí sería recalcular una precisión que el texto no muestra.
 */
const DECIMALES_DE_LA_CUENTA: Readonly<Record<MetricaUnidad, number>> = {
  porcentaje: 3,
  conteo: 0,
  segundos: 0,
  moneda: 0,
};

export interface KpiValorProps {
  /** `null` = dato ausente; se pinta sin animar. */
  valor: number | null;
  unidad: MetricaUnidad;
}

export function KpiValor({ valor, unidad }: Readonly<KpiValorProps>) {
  // Memoizada: `react-countup` relanza la cuenta desde 0 cuando cambia la IDENTIDAD de su
  // `formattingFn`, así que sin esto cualquier re-render del padre —pasar el ratón por una
  // gráfica vecina basta— reiniciaría el contador.
  const formatear = useCallback((n: number) => formatearValor(n, unidad), [unidad]);

  if (valor === null || !Number.isFinite(valor)) {
    return <>{formatearValor(valor, unidad)}</>;
  }

  return (
    <KpiValorAnimado
      value={valor}
      formatear={formatear}
      decimales={DECIMALES_DE_LA_CUENTA[unidad]}
      arrancarEnCero
    />
  );
}
