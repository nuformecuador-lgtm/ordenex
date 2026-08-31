import { Prisma } from "@prisma/client";

/**
 * Feature 255 — serializacion de los importes de la COTIZACION por API key.
 *
 * ENMIENDA DEL 2026-08-28 (ficha 319) — LOS IMPORTES SE SIRVEN CRUDOS.
 *
 * Hasta hoy este modulo FORMATEABA: simbolo de moneda, miles agrupados y coma
 * decimal, leyendo los tres caracteres de `monedaConfig`. La decision A3 de la
 * 255 (R34) mandaba servir esa forma y SOLO esa. Se revierte: lo que viaja ahora
 * es el importe CRUDO, `2500.00`, y sigue sin haber una segunda representacion
 * en paralelo — la mitad de A3 que se conserva, y la que de verdad importaba:
 * una sola forma por campo, nunca dos que se desincronizan.
 *
 * POR QUE. El consumidor de este contrato es una maquina, y a una maquina el
 * formateo le estorba: la forma anterior obligaba al integrador a deshacer un
 * simbolo y DOS separadores —con el punto haciendo de miles y la coma de
 * decimal, que es justo el orden que rompe un `parseFloat` ingenuo sin fallar,
 * devolviendo un numero plausible y equivocado— antes de poder sumar. Ademas el
 * canal hablaba dos dialectos: el `costoEnvio` de
 * `POST /api/ordenes/api-key/carga` ya viajaba crudo, en string money-safe de
 * escala 2. Ahora los dos endpoints dicen el dinero igual.
 *
 * SIGUE SIENDO UNA SALIDA DE MAQUINA, y por eso conserva los DOS DECIMALES: un
 * precio que se sirve como respuesta no puede perder centimos por el camino. Esa
 * es la excepcion declarada que la guardia 230 vigila en su diente 6, y no
 * cambia con esta enmienda; lo unico que cambia es que el separador ya no sale
 * de `monedaConfig` sino que es el PUNTO canonico del formato money-safe, el
 * mismo que usan el resto de importes que el repo serializa para maquinas.
 *
 * NINGUNA PANTALLA DEBE CONSUMIRLO. El dinero que se PINTA va sin centimos y
 * sale de `lib/config/moneda.ts` (`formatMontoString`/`money`/`formatMonto`).
 * Importar este modulo desde `app/**` o `components/**` es un error: la guardia
 * de la feature 230 lo persigue.
 *
 * EL REDONDEO TIENE UN SOLO DUEÑO, Y NO ES ESTE MODULO. Aqui no se aplica ninguna
 * politica de redondeo propia: se serializa con `Prisma.Decimal.toFixed(2)`. Ojo
 * con el matiz, porque no es "no redondea": `toFixed(2)` SI redondea si le llega
 * una escala mayor que 2 (`1.005` -> `1.01`, documentado en
 * `tests/unit/utils/monto-cotizacion.test.ts`).
 *
 * Lo que hoy hace ese redondeo inalcanzable desde la cotizacion es que todo importe
 * llega ya redondeado a escala 2 por la aritmetica de dinero (`round2`/
 * `aplicarPorcentaje` dentro de `derivarIngresoOrden`, ROUND_HALF_UP). Esa es la
 * condicion, no una propiedad del serializador: si algun dia entrara aqui un decimal
 * de escala > 2, el importe cambiaria de valor AQUI, y eso seria la señal de que la
 * aritmetica de arriba dejo de hacer su trabajo — no la invitacion a añadir una
 * segunda politica de redondeo en la serializacion.
 */

/**
 * La forma serializada de un importe: signo opcional, parte entera SIN agrupar y
 * exactamente dos digitos tras el punto, que es lo que devuelve
 * `Prisma.Decimal.toFixed(2)`.
 *
 * El punto se escribe aqui como literal a proposito, y eso ya no contradice la
 * R36 de la 255 (que prohibia hardcodear el separador): R36 hablaba de
 * CONFIGURACION DE MONEDA —simbolo y separadores de presentacion, que son
 * contexto— y este punto no es ninguna de las dos cosas. Es el separador decimal
 * del formato money-safe con el que el repo serializa dinero para maquinas, el
 * mismo del `costoEnvio` de la carga; no se localiza, igual que no se localiza el
 * `YYYY-MM-DD` de una fecha en un contrato.
 */
const IMPORTE_SERIALIZADO = /^(-?)(\d+)\.(\d{2})$/;

/** Digitos que valen cero, con los ceros a la izquierda que traigan. */
function esCero(digitos: string): boolean {
  return /^0*$/.test(digitos);
}

/**
 * Serializa un importe de la cotizacion: `[signo][enteros].[dos digitos]`.
 *
 * Recibe un `Prisma.Decimal` y NUNCA un string, a proposito: asi la
 * serializacion es literalmente el ultimo paso del calculo y no hay forma de
 * encadenar dos ni de re-parsear un importe ya serializado para volver a operar
 * con el (R55).
 *
 * El signo negativo desaparece cuando el importe vale cero (R38): "menos cero" no
 * es una cantidad, y un centimo que se cayo en el redondeo no puede reaparecer
 * convertido en un signo. La R37 —el signo DELANTE del simbolo— se extingue con
 * esta enmienda: ya no hay simbolo delante del que ponerlo.
 *
 * @param valor importe exacto, ya redondeado a escala 2 por la aritmetica.
 * @throws si el importe no es un decimal finito. No hay rama "verbatim": este
 *   borde sirve precios, y un texto sin forma de importe servido como precio
 *   seria peor que un fallo ruidoso.
 */
export function serializarMontoCotizacion(valor: Prisma.Decimal): string {
  const serializado = valor.toFixed(2);
  const casa = IMPORTE_SERIALIZADO.exec(serializado);
  if (casa === null) {
    throw new Error(
      `serializarMontoCotizacion: el importe no es un decimal finito (${serializado})`,
    );
  }

  const [, signoCrudo, enteros, decimales] = casa;
  const negativo = signoCrudo !== "" && !(esCero(enteros) && esCero(decimales));

  return `${negativo ? "-" : ""}${enteros}.${decimales}`;
}
