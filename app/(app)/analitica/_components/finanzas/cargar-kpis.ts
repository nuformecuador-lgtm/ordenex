// El CARGADOR de los seis KPIs financieros de la analitica. Modulo de SERVIDOR.
//
// ─── NO HAY CIFRA NUEVA AQUI, Y ESE ES EL PUNTO ─────────────────────────────────────────
//
// Los seis numeros salen ENTEROS de la caja y de los dos ledgers que ya existen, por sus
// Server Actions, exactamente igual que los pide la pantalla `/wallet`. Este archivo no
// consulta la base, no toca Prisma, no deriva dinero y no conoce ninguna regla de negocio:
// pide tres respuestas, las suma donde hace falta con el sumador money-safe y las rotula.
//
// Es deliberado hasta el detalle de las CUATRO primeras cifras: `verResumenCajaAction`
// devuelve el mismo `CajaResumenDTO` que pinta `CajaResumenCard` en el wallet, asi que
// «Dinero en caja» y «Ganancia de Ordenex» valen aqui LO MISMO que alla, numero por numero.
// Recalcularlas —aunque fuera con la misma formula— habria creado una segunda definicion de
// la ganancia, y dos definiciones de la ganancia acaban dando dos ganancias.
//
// ─── SIN FILTROS, POR DECISION (2026-08-18) ─────────────────────────────────────────────
//
// Las tres llamadas van con la entrada VACIA: estos KPIs son el estado de las cuentas HOY, no
// el de un periodo. Por eso esta seccion no cuelga de la barra de entregas y no re-consulta
// cuando alguien cambia un filtro. Consecuencia que hay que tener presente: «Dinero en caja»
// es el saldo del libro entero; con filtros seria «el neto del periodo», que es otra cifra con
// el mismo nombre — el propio DTO lleva `periodoFiltrado` justamente para no confundirlas.
//
// ─── QUIEN LOS VE: LO DECIDEN LOS SERVICIOS, NO ESTE ARCHIVO ────────────────────────────
//
// ⚠ Los tres origenes exigen ACCESO TOTAL (`esAccesoTotal`: maestro/admin) y devuelven
// `forbidden` a todo lo demas. La seccion se monta para los mismos roles que la de entregas
// —asi se pidio—, de modo que un adminTienda o un adminSatelite VE la seccion y recibe el
// estado «denegado» en las tarjetas, nunca una cifra ajena. No se afloja ni un gate: la caja
// central y los saldos de TODAS las tiendas son dinero de otros inquilinos, y ensenarlos
// recortados «por si acaso» exigiria decidir que parte le toca a cada rol, que es una decision
// de producto que nadie ha tomado.

import { listarCuentasPorPagarCompletoAction } from "@/lib/actions/wallet-mensajero";
import { listarSaldosTiendasCompletoAction } from "@/lib/actions/wallet-tienda";
import { verResumenCajaAction } from "@/lib/actions/wallet";
import { sumarMontos } from "@/lib/utils/kpis-financieros";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

/**
 * Un KPI ya resuelto. Tres estados y solo tres, los MISMOS que usa el tablero financiero
 * (`PanelFinanciero`): una tarjeta que no trajo dato no se pinta en cero — un cero es una
 * cifra medida y «no puedes verlo» no lo es.
 *
 * `denegado` NO lleva motivo, igual que el `forbidden` del borde: con el motivo se podrian
 * enumerar los permisos de cada rol preguntando.
 */
export type KpiFinanciero =
  | { readonly estado: "ok"; readonly id: string; readonly etiqueta: string; readonly pista?: string; readonly monto: string }
  | { readonly estado: "denegado"; readonly id: string; readonly etiqueta: string }
  | { readonly estado: "error"; readonly id: string; readonly etiqueta: string; readonly mensaje: string };

/** Los rotulos, en un solo sitio. Los cuatro primeros son los del wallet, palabra por palabra:
 *  la misma cifra con dos nombres distintos en dos pantallas se lee como dos cifras. */
const ETIQUETA = {
  ingresos: "Ingresos",
  egresos: "Egresos",
  enCaja: "Dinero en caja",
  ganancia: "Ganancia de Ordenex",
  porPagarTiendas: "Por pagar a tiendas",
  porPagarMensajeros: "Por pagar a mensajeros",
} as const;

const PISTA = {
  enCaja: "Todo lo que entró menos todo lo que salió, incluido el dinero de las tiendas",
  ganancia: "Lo que Ordenex gana menos lo que gasta",
  // ⚠ NO es la tercera línea del wallet («contra-entrega cobrado y aún no entregado»): aquella
  // es el COD bruto, y de ese dinero Ordenex todavía descuenta flete, comisión e impuesto.
  // Esto es la suma de los saldos ya netos de cada tienda, que es lo que de verdad hay que
  // pagarles. Decirlo aquí evita que las dos cifras se lean como la misma y «no cuadren».
  porPagarTiendas: "Suma del saldo de cada tienda, ya descontado lo de Ordenex",
  porPagarMensajeros: "Suma de lo devengado y aún no pagado a cada mensajero",
} as const;

const MENSAJE_ERROR = "No se pudo consultar la cifra.";
/** El dataset supera el tope de descarga: sumarlo daría un total CORTO, que es peor que no
 *  darlo. Se dice que no se pudo, y no se enseña media suma. */
const MENSAJE_LIMITE = "Hay demasiadas cuentas para sumarlas aquí.";

function denegado(id: string, etiqueta: string): KpiFinanciero {
  return { estado: "denegado", id, etiqueta };
}

function error(id: string, etiqueta: string, mensaje = MENSAJE_ERROR): KpiFinanciero {
  return { estado: "error", id, etiqueta, mensaje };
}

/** Los seis ids con su rotulo y su pista, en el orden en que se pintan. Una sola lista: el
 *  cargador y el atajo de «denegado» tienen que producir las MISMAS seis tarjetas, o un rol sin
 *  acceso veria una rejilla de otro tamano que la del maestro. */
const CATALOGO: readonly [string, string, string | undefined][] = [
  ["ingresos", ETIQUETA.ingresos, undefined],
  ["egresos", ETIQUETA.egresos, undefined],
  ["enCaja", ETIQUETA.enCaja, PISTA.enCaja],
  ["ganancia", ETIQUETA.ganancia, PISTA.ganancia],
  ["porPagarTiendas", ETIQUETA.porPagarTiendas, PISTA.porPagarTiendas],
  ["porPagarMensajeros", ETIQUETA.porPagarMensajeros, PISTA.porPagarMensajeros],
];

/**
 * Las seis tarjetas en estado «denegado», SIN tocar la base.
 *
 * Es el atajo para los roles sin acceso total, y existe por la misma razon por la que la
 * pagina no prefetchea el tablero financiero fuera de `esAccesoTotal` (R9 de la 132): un rol
 * denegado no debe llegar a consultar el dinero **ni una sola vez**. Sin esto, cada carga de la
 * pantalla de un adminTienda dispararia tres consultas que solo pueden responder «no».
 *
 * El resultado visible es exactamente el mismo que si se hubieran pedido: los servicios
 * responden `forbidden` a estos roles. Lo que cambia es que no se pregunta.
 */
/**
 * @sin-superficie la seccion de finanzas de `/analitica` se comento entera el 2026-08-18 por
 * decision humana, y con ella se fue el unico sitio que montaba esto. El codigo se conserva
 * —esta hecho y probado— y volver a encenderlo es descomentar el bloque de `page.tsx` y sus
 * imports. La anotacion CADUCA: en cuanto la seccion vuelva hay que retirarla, y la guardia lo
 * exige.
 */
export function kpisDenegados(): readonly KpiFinanciero[] {
  return CATALOGO.map(([id, etiqueta]) => denegado(id, etiqueta));
}

/** Las CUATRO cifras de la caja central, o el mismo estado repetido en las cuatro. */
async function kpisDeCaja(): Promise<KpiFinanciero[]> {
  // Las cuatro primeras del catalogo: las que salen del libro de la caja.
  const entradas = CATALOGO.slice(0, 4);

  const respuesta = await verResumenCajaAction({});

  if (respuesta.status !== "ok") {
    // Un `forbidden` es «no te toca» y cualquier otra cosa es un fallo. Las cuatro tarjetas
    // comparten origen, así que comparten estado: fingir que tres se pudieron y una no sería
    // mentir sobre de dónde salen.
    const caido =
      respuesta.status === "forbidden"
        ? (id: string, etiqueta: string) => denegado(id, etiqueta)
        : (id: string, etiqueta: string) => error(id, etiqueta);
    return entradas.map(([id, etiqueta]) => caido(id, etiqueta));
  }

  const { resumen } = respuesta;
  const montos: Record<string, string> = {
    ingresos: resumen.entradas,
    egresos: resumen.salidas,
    enCaja: resumen.enCaja,
    ganancia: resumen.ganancia,
  };

  return entradas.map(([id, etiqueta, pista]) => ({
    estado: "ok" as const,
    id,
    etiqueta,
    ...(pista === undefined ? {} : { pista }),
    monto: montos[id] ?? "0.00",
  }));
}

/**
 * La suma de una lista de saldos, o el estado que impidio sumarla.
 *
 * GENERICA sobre `ListarCompletoResult<T>`: las dos listas —tiendas y mensajeros— tienen la
 * MISMA forma de resultado y solo cambian en que campo lleva el importe, asi que el `switch`
 * de estados se escribe una vez. El importe se extrae con una funcion del llamador y no con
 * un nombre de campo en texto: asi el compilador comprueba que el campo existe, en vez de
 * devolver `undefined` en tiempo de ejecucion y sumar cero en silencio.
 */
function sumaDeLista<T>(
  id: string,
  etiqueta: string,
  pista: string,
  respuesta: ListarCompletoResult<T>,
  importeDe: (item: T) => string,
): KpiFinanciero {
  if (respuesta.status === "ok") {
    return {
      estado: "ok",
      id,
      etiqueta,
      pista,
      // Los importes llegan como STRING con su signo dentro y se suman con `Prisma.Decimal`:
      // aqui no se convierte dinero a `number` ni de paso.
      monto: sumarMontos(respuesta.items.map(importeDe)),
    };
  }
  if (respuesta.status === "forbidden") return denegado(id, etiqueta);
  // El dataset supera el tope: sumar lo que cupo daria un total CORTO con pinta de completo.
  if (respuesta.status === "limite_excedido") return error(id, etiqueta, MENSAJE_LIMITE);
  return error(id, etiqueta);
}

/**
 * Los SEIS KPIs, pedidos en paralelo.
 *
 * Las tres llamadas son independientes y un fallo de una NO tumba a las otras (mismo criterio
 * que `cargarTableroFinanciero`): quien no trajo dato se pinta con su estado y el resto se
 * pinta con su cifra. `Promise.all` y no una cadena de `await`: son tres viajes que no se
 * necesitan entre sí.
 *
 * NO se pasa `deps` a ninguna acción: ese argumento es el punto de inyección PARA TESTS y
 * lleva funciones (`getActor`), así que usarlo desde producción convertiría a este llamador en
 * una segunda autoridad sobre «quién eres» — y una función no cruza la frontera RSC.
 */
/**
 * @sin-superficie la seccion de finanzas de `/analitica` se comento entera el 2026-08-18 por
 * decision humana, y con ella se fue el unico sitio que montaba esto. El codigo se conserva
 * —esta hecho y probado— y volver a encenderlo es descomentar el bloque de `page.tsx` y sus
 * imports. La anotacion CADUCA: en cuanto la seccion vuelva hay que retirarla, y la guardia lo
 * exige.
 */
export async function cargarKpisFinancieros(): Promise<readonly KpiFinanciero[]> {
  const [caja, tiendas, mensajeros] = await Promise.all([
    kpisDeCaja(),
    listarSaldosTiendasCompletoAction({}),
    listarCuentasPorPagarCompletoAction({}),
  ]);

  return [
    ...caja,
    sumaDeLista(
      "porPagarTiendas",
      ETIQUETA.porPagarTiendas,
      PISTA.porPagarTiendas,
      tiendas,
      (tienda) => tienda.saldo,
    ),
    sumaDeLista(
      "porPagarMensajeros",
      ETIQUETA.porPagarMensajeros,
      PISTA.porPagarMensajeros,
      mensajeros,
      (mensajero) => mensajero.cuentaPorPagar,
    ),
  ];
}
