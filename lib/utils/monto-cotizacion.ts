import { Prisma } from "@prisma/client";
import { monedaConfig } from "@/lib/config/moneda";

/**
 * Feature 255 — formateo de los importes de la COTIZACION por API key.
 *
 * ⚠️ ESTO ES UNA SALIDA DE MAQUINA. Lo que produce esta funcion viaja en el
 * contrato JSON del canal por API key (`POST /api/ordenes/api-key/cotizacion`)
 * y lo lee un integrador, no una persona. Por eso —y SOLO por eso— SI emite dos
 * digitos tras el separador decimal: un precio que se sirve como respuesta no
 * puede perder centimos por el camino. Es la misma excepcion declarada que ya
 * tienen las descargas XLSX/CSV ("la contabilidad los necesita", feature 230).
 *
 * NINGUNA PANTALLA DEBE CONSUMIRLO. El dinero que se PINTA va sin centimos y
 * sale de `lib/config/moneda.ts` (`formatMontoString`/`money`/`formatMonto`).
 * Importar este modulo desde `app/**` o `components/**` es un error: la guardia
 * de la feature 230 lo persigue.
 *
 * EL REDONDEO TIENE UN SOLO DUEÑO, Y NO ES ESTE MODULO. Aqui no se aplica ninguna
 * politica de redondeo propia: se serializa con `Prisma.Decimal.toFixed(2)`, se
 * agrupa y se compone. Ojo con el matiz, porque no es "no redondea": `toFixed(2)`
 * SI redondea si le llega una escala mayor que 2 (`1.005` -> `1.01`, documentado en
 * `tests/unit/utils/monto-cotizacion.test.ts`).
 *
 * Lo que hoy hace ese redondeo inalcanzable desde la cotizacion es que todo importe
 * llega ya redondeado a escala 2 por la aritmetica de dinero (`round2`/
 * `aplicarPorcentaje` dentro de `derivarIngresoOrden`, ROUND_HALF_UP). Esa es la
 * condicion, no una propiedad del formateador: si algun dia entrara aqui un decimal
 * de escala > 2, el importe cambiaria de valor AQUI, y eso seria la señal de que la
 * aritmetica de arriba dejo de hacer su trabajo — no la invitacion a añadir una
 * segunda politica de redondeo en el formateo.
 */

/**
 * La forma serializada de un importe: signo opcional, parte entera y EXACTAMENTE
 * dos decimales, que es lo que devuelve `Prisma.Decimal.toFixed(2)`.
 *
 * El separador que produce `toFixed` se casa con `\D` y no con el caracter
 * escrito a mano: R36 prohibe que este fuente escriba el simbolo o cualquiera de
 * los dos separadores como literal, y esa prohibicion se cumple tambien aqui.
 */
const IMPORTE_SERIALIZADO = /^(-?)(\d+)\D(\d{2})$/;

/**
 * Agrupa la parte entera de tres en tres DESDE LA DERECHA.
 *
 * El borde esta al principio: con tres digitos exactos (`999`) o con un multiplo
 * de tres (`1000`) una agrupacion mal escrita cuela un separador delante del
 * primer grupo. Por eso se recorre desde el final y el `join` solo pone
 * separador ENTRE grupos.
 *
 * Se agrupa DESPUES de serializar (R39): el acarreo del redondeo que hizo la
 * aritmetica puede haber añadido un digito a la parte entera.
 */
function agruparMiles(enteros: string): string {
  const grupos: string[] = [];
  for (let fin = enteros.length; fin > 0; fin -= 3) {
    grupos.unshift(enteros.slice(Math.max(0, fin - 3), fin));
  }
  return grupos.join(monedaConfig.separadorMiles);
}

/** Digitos que valen cero, con los ceros a la izquierda que traigan. */
function esCero(digitos: string): boolean {
  return /^0*$/.test(digitos);
}

/**
 * Formatea un importe de la cotizacion:
 * `[signo][simbolo][enteros agrupados][separador decimal][2 digitos]`.
 *
 * Recibe un `Prisma.Decimal` y NUNCA un string, a proposito: asi el formateo es
 * literalmente el ultimo paso del calculo y no hay forma de encadenar dos
 * formateos ni de re-parsear un importe ya formateado para volver a operar con
 * el (R55). El simbolo, el separador de miles y el separador decimal se LEEN de
 * `monedaConfig`; ninguno se escribe a mano (R36, "sin hardcode de contexto").
 *
 * El signo negativo va DELANTE del simbolo (R37) y desaparece cuando el importe
 * vale cero (R38): "menos cero" no es una cantidad, y un centimo que se cayo en
 * el redondeo no puede reaparecer convertido en un signo.
 *
 * @param valor importe exacto, ya redondeado a escala 2 por la aritmetica.
 * @throws si el importe no es un decimal finito. No hay rama "verbatim": este
 *   borde sirve precios, y un texto sin forma de importe servido como precio
 *   seria peor que un fallo ruidoso.
 */
export function formatMontoCotizacion(valor: Prisma.Decimal): string {
  const serializado = valor.toFixed(2);
  const casa = IMPORTE_SERIALIZADO.exec(serializado);
  if (casa === null) {
    throw new Error(`formatMontoCotizacion: el importe no es un decimal finito (${serializado})`);
  }

  const [, signoCrudo, enteros, decimales] = casa;
  const negativo = signoCrudo !== "" && !(esCero(enteros) && esCero(decimales));
  const signo = negativo ? "-" : "";

  return `${signo}${monedaConfig.simbolo}${agruparMiles(enteros)}${monedaConfig.separadorDecimal}${decimales}`;
}
