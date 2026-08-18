import { Prisma } from "@prisma/client";

import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import type { AgregadoDiarioCajaRow } from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";
import type { FinanzasDeUnDia } from "@/lib/types/finanzas-diario";

/**
 * Feature del 2026-08-18 — las CUATRO cifras del dinero, dia a dia.
 *
 * Funcion PURA (no conoce la base) y money-safe de punta a punta: `Prisma.Decimal` dentro,
 * STRING fuera, `number` en ninguna parte.
 *
 * ⚠ NO REIMPLEMENTA NI UNA REGLA DE LA CAJA. La particion propio/terceros sale de
 * `NATURALEZA_POR_CATEGORIA` y las restas con signo de `derivarBalance`, que son exactamente
 * las dos piezas que usa `derivarCaja` para el libro entero. Esta funcion es `derivarCaja`
 * aplicada POR DIA y con una cifra mas; escribir aqui una segunda clasificacion de categorias
 * seria abrir una segunda definicion de la ganancia, y dos definiciones de la ganancia acaban
 * dando dos ganancias.
 *
 * Y por eso mismo la suma de los dias CUADRA con el resumen del wallet: son la misma
 * clasificacion sobre las mismas filas, agrupadas de otra manera.
 */

/** La categoria del pago a mensajeros. Es un value del enum de la caja, no un nombre inventado:
 *  si el enum lo renombrara, `NATURALEZA_POR_CATEGORIA` dejaria de compilar y esto se veria. */
const CATEGORIA_PAGO_MENSAJERO: keyof typeof NATURALEZA_POR_CATEGORIA = "egreso_pago_mensajero";

/**
 * La categoria del pago a TIENDAS. Mismo criterio que la anterior: es un value del enum, no un
 * nombre escrito a mano.
 *
 * ⚠ NO SE NETEA CON `ingreso_reverso_pago_tienda`, que existe en el mismo enum y devuelve el
 * dinero a la caja cuando se anula un pago. Dos motivos: esta cifra responde «cuanto SALIO
 * hacia tiendas ese dia», y un reverso es un hecho de OTRO dia —netearlos dejaria dias en
 * negativo, que en una barra apilada no se puede dibujar—; y ademas el reverso ya esta
 * reflejado donde tiene que estarlo, en `ingresos` y en la ganancia de su propio dia.
 */
const CATEGORIA_PAGO_TIENDA: keyof typeof NATURALEZA_POR_CATEGORIA = "egreso_pago_tienda";

const CERO = () => new Prisma.Decimal(0);

interface AcumuladoDia {
  entradas: Prisma.Decimal;
  salidas: Prisma.Decimal;
  ingresosPropios: Prisma.Decimal;
  egresosPropios: Prisma.Decimal;
  pagoMensajeros: Prisma.Decimal;
  pagoTiendas: Prisma.Decimal;
}

function nuevoDia(): AcumuladoDia {
  return {
    entradas: CERO(),
    salidas: CERO(),
    ingresosPropios: CERO(),
    egresosPropios: CERO(),
    pagoMensajeros: CERO(),
    pagoTiendas: CERO(),
  };
}

/**
 * Agrupa las filas `(fecha, categoria, tipo, total)` en una entrada por dia.
 *
 * El orden de salida es CRONOLOGICO ASCENDENTE y se impone AQUI, ordenando las claves: aunque
 * el repositorio ya ordena, una serie temporal que dependa del orden en que llegaron las filas
 * se pinta al reves el dia que alguien toque el `ORDER BY`. Como la clave es `YYYY-MM-DD`, el
 * orden lexicografico ES el cronologico.
 *
 * Los dias SIN movimientos no aparecen: no hay filas que agrupar. Rellenarlos exigiria conocer
 * la ventana, que es de quien la pidio.
 */
export function derivarFinanzasDiarias(
  filas: readonly AgregadoDiarioCajaRow[],
): readonly FinanzasDeUnDia[] {
  const porDia = new Map<string, AcumuladoDia>();

  for (const fila of filas) {
    const dia = porDia.get(fila.fecha) ?? nuevoDia();
    const monto = new Prisma.Decimal(fila.total);
    // El signo lo da el TIPO; la cubeta, la CATEGORIA. Que las dos cosas casen lo garantiza el
    // CHECK categoria↔tipo de la base, no este archivo.
    const esPropio = NATURALEZA_POR_CATEGORIA[fila.categoria] === "propio";

    if (fila.tipo === "ingreso") {
      dia.entradas = dia.entradas.add(monto);
      if (esPropio) dia.ingresosPropios = dia.ingresosPropios.add(monto);
    } else {
      dia.salidas = dia.salidas.add(monto);
      if (esPropio) dia.egresosPropios = dia.egresosPropios.add(monto);
      // Los dos pagos se acumulan ADEMAS de sumar a los egresos, no en vez de: ya estan dentro
      // de ellos. Sumarlos aparte al total los contaria dos veces.
      if (fila.categoria === CATEGORIA_PAGO_MENSAJERO) {
        dia.pagoMensajeros = dia.pagoMensajeros.add(monto);
      }
      if (fila.categoria === CATEGORIA_PAGO_TIENDA) {
        dia.pagoTiendas = dia.pagoTiendas.add(monto);
      }
    }

    porDia.set(fila.fecha, dia);
  }

  return [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, acc]) => {
      // Las TRES restas con signo las hace `derivarBalance`, que ya existe y ya esta probada.
      const caja = derivarBalance(acc.entradas, acc.salidas);
      const propio = derivarBalance(acc.ingresosPropios, acc.egresosPropios);
      return {
        fecha,
        ingresos: caja.ingresos,
        egresos: caja.egresos,
        ganancia: propio.balance,
        pagoMensajeros: acc.pagoMensajeros.toFixed(2),
        pagoTiendas: acc.pagoTiendas.toFixed(2),
      };
    });
}
