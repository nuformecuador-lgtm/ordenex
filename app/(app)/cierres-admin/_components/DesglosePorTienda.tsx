"use client";

// FICHA 396 — el tipo del desglose se pide DONDE VIVE la identidad que particiona
// (`lib/utils/ingreso-ordenex.ts`), igual que hacen los dos contratos de servicio. Es un
// `import type`: se borra al compilar y no arrastra ni `Prisma` ni una línea de servidor al
// navegador.
import type { ParteDeTienda } from "@/lib/utils/ingreso-ordenex";

import { CascadaDinero, type LineaCascada } from "./CascadaDinero";
// Los rótulos se piden al módulo PURO directamente, y NO por el re-export de
// `cierre-detalle-shared`: ese camino existe para las etiquetas que también necesita el archivo
// de la descarga, y las descargas de cierres no se tocan en esta ficha (R27).
import {
  DESGLOSE_NO_REPARTIDO_NOTA,
  DESGLOSE_POR_TIENDA_NOTA,
  DESGLOSE_POR_TIENDA_TITULO,
  TIENDA_GANA_TOTAL_LABEL,
  TIENDA_PAGO_HOY_LABEL,
  TIENDA_RECAUDADO_LABEL,
  nombreAccesibleDeTienda,
  totalDeVariasTiendasNota,
} from "./cierre-labels";

/**
 * 💰 FICHA 396 — DE QUÉ TIENDA ES CADA PARTE. **EL MISMO componente en las TRES superficies**
 * (R22): el detalle del cierre de MENSAJERO, y los DOS niveles del detalle del cierre de BODEGA
 * —el de cada mensajero incluido y el agregado de toda la bodega—.
 *
 * ── LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE TODO LO DEMÁS
 * **El dinero está BIEN, y esto no es una corrección de dinero.** `wallet_tienda_movimiento`
 * lleva los movimientos separados por tienda desde siempre, cada uno con sus propias cifras: a
 * nadie se le paga mal, y esta ficha no toca ni una fila del ledger. Lo que faltaba es que la
 * PANTALLA dijera de quién es cada parte de un total que ya era correcto como total.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE, Y ES UNA DECISIÓN DEL `frontend_dev` DE LA TANDA D
 * Nació como una función local de `CascadasCierreMensajero.tsx` (tanda C), donde sólo tenía un
 * consumidor. Con la tanda de BODEGA pasa a tener tres, en DOS módulos distintos, y dejarlo
 * dentro de la pantalla del mensajero significaría que el detalle de bodega renderiza desde un
 * archivo que se llama como otra superficie — sin ninguna señal para quien un día edite aquél.
 * R22 pide «el mismo componente» en las tres: un componente compartido que vive dentro de una de
 * ellas lo cumple de milagro, no por construcción.
 *
 * El coste de sacarlo es tocar el censo de `tests/components/DineroIdentidadesEnPantalla.test.tsx`
 * —cuyo cardinal es una FOTO a propósito—, y **se paga a sabiendas**: ese censo existe para que
 * una pantalla de dinero nueva se declare en vez de colarse, así que esconder el componente
 * dentro de un archivo ya censado sería usar la guardia al revés.
 *
 * ── NI UNA OPERACIÓN ARITMÉTICA (R14)
 * Las tres cifras de cada tienda llegan YA DERIVADAS del servidor, como STRING con su signo, y
 * la lista llega **ya ordenada** por él (R8: por lo que se le paga, de mayor a menor, con su
 * desempate declarado). Aquí no se suma, no se resta, no se redondea, no se convierte y **no se
 * reordena**: sólo se cuenta cuántos elementos hay, que es un cardinal y no un importe.
 *
 * ── POR QUÉ LA CASCADA DE UNA TIENDA NO LLEVA OPERADORES
 * Las otras cascadas del detalle cierran una cuenta; ésta enseña TRES lecturas de la misma
 * tienda. Para pintarla como resta haría falta una cuarta cifra —lo que Ordenex le factura a ESA
 * tienda— y R5 la prohíbe: tres cifras por tienda y ni una más. Inventar una resta que no se
 * puede completar sería justo el defecto que la ficha 395 arregló un nivel más arriba.
 */

/**
 * 💰 FICHA 396 — LAS TRES CIFRAS DE UNA TIENDA, y ni una más (R5).
 *
 * Las dos de pago van DESTACADAS y en este orden —primero lo que se le paga hoy, luego lo que
 * gana en total— porque es el orden en que las lee la cascada de arriba, y porque el rótulo de
 * cada una dice con todas las letras cuál es cuál: «hoy» frente a «en total».
 *
 * `ganaLaTienda` de una tienda que sólo trajo rechazos es NEGATIVO, y sale con su signo y en
 * tono de atención —`CascadaDinero` lo tiñe por ser un resultado destacado—: nunca recortado a
 * cero, que diría algo falso justo donde el desglose informa de lo que el agregado tapaba (R9).
 *
 * Ni un importe se toca aquí: los tres se pintan tal como llegan.
 */
function lineasDeTienda(parte: ParteDeTienda): LineaCascada[] {
  return [
    { label: TIENDA_RECAUDADO_LABEL, monto: parte.recaudado, signo: "neutro" },
    { label: TIENDA_PAGO_HOY_LABEL, monto: parte.pagoTienda, signo: "neutro", destacado: true },
    {
      label: TIENDA_GANA_TOTAL_LABEL,
      monto: parte.ganaLaTienda,
      signo: "neutro",
      destacado: true,
    },
  ];
}

/**
 * 💰 FICHA 396 — EL UMBRAL (R2, Q5) Y LA MARCA (R1), en UNA sola función y para las TRES
 * superficies.
 *
 * Devuelve la frase que dice que el importe de al lado es un total de VARIAS tiendas y de
 * cuántas, o `null` cuando el nivel tiene UNA sola tienda: ahí la pantalla se queda **exactamente
 * como estaba** —ni marca, ni título, ni notas, ni una cascada—.
 *
 * ⚠️ **EL UMBRAL SE EVALÚA SOBRE LAS TIENDAS DEL NIVEL QUE SE ESTÁ PINTANDO, Y SON TRES NIVELES
 * DISTINTOS.** El del cierre de un mensajero mira las tiendas de ESE mensajero; el agregado de
 * bodega, las de toda la bodega. No son el mismo número: un cierre de bodega con dos mensajeros
 * que llevaron UNA tienda cada uno no enseña desglose en ningún nivel de mensajero y **sí** en el
 * agregado. Por eso esta función recibe la lista del nivel y nunca una de más arriba.
 *
 * Está en un solo sitio a propósito: la marca y el desglose tienen que aparecer y desaparecer
 * JUNTOS. Escrito tres veces, el primer `>= 2` que alguien tocara dejaría una pantalla diciendo
 * «es el total de 2 tiendas» sin enseñar ninguna, o al revés.
 *
 * El servidor emite `partesPorTienda` SIEMPRE —también con una sola tienda— para que ningún
 * consumidor tenga que distinguir dos formas del mismo dato; quien decide enseñarlo es la
 * pantalla, contando cuántos elementos trae la lista.
 */
export function marcaDeVariasTiendas(partes: readonly ParteDeTienda[]): string | null {
  return partes.length >= 2 ? totalDeVariasTiendasNota(partes.length) : null;
}

export interface DesglosePorTiendaProps {
  /** Las tiendas de ESTE nivel, ya derivadas y ya ordenadas por el servidor (R8). */
  partes: readonly ParteDeTienda[];
  /**
   * De qué es este desglose: `cierre de Ana Mensajera`, `cierre de bodega`, o el nombre del
   * mensajero de un `cierre_dia` dentro del detalle de bodega. Da nombre PROPIO a la región y a
   * cada una de sus cascadas — el modal de bodega monta este mismo bloque una vez por mensajero
   * incluido más una para el agregado, y sin esto todas se anunciarían igual.
   */
  de: string;
}

/**
 * 💰 FICHA 396 — EL DESGLOSE: una cascada por tienda, en el orden que emite el servidor.
 *
 * Es una región propia con nombre accesible, y dentro va una región por tienda: la pantalla ya
 * monta varias cascadas y sin nombres distintos un lector de pantalla las anunciaría todas igual.
 *
 * ⚠️ DOS TIENDAS HOMÓNIMAS son un caso REAL y permitido a propósito —el servidor agrupa por el
 * identificador congelado, no por el nombre (R7)—, así que el nombre no basta para nombrar la
 * región: el discriminante lo pone `nombreAccesibleDeTienda` con la posición y el contexto. La
 * `key` de React, en cambio, es el `tiendaId`: la identidad es del dato, no de la posición.
 *
 * Las dos notas de cabecera van UNA vez para todo el desglose: la que separa las dos cifras de
 * pago, y la que dice qué NO está repartido (R17).
 */
export function DesglosePorTienda({ partes, de }: Readonly<DesglosePorTiendaProps>) {
  return (
    <section aria-label={`${DESGLOSE_POR_TIENDA_TITULO} · ${de}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{DESGLOSE_POR_TIENDA_TITULO}</h3>
        <p className="text-xs text-muted-foreground">{DESGLOSE_POR_TIENDA_NOTA}</p>
        <p className="text-xs text-muted-foreground">{DESGLOSE_NO_REPARTIDO_NOTA}</p>
      </div>
      {partes.map((parte, indice) => (
        <CascadaDinero
          key={parte.tiendaId}
          titulo={parte.tiendaNombre}
          ariaLabel={nombreAccesibleDeTienda(parte.tiendaNombre, indice, partes.length, de)}
          lineas={lineasDeTienda(parte)}
        />
      ))}
    </section>
  );
}
