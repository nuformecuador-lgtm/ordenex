import { z } from "zod";

import { cotizadorConfig } from "@/lib/config/cotizador";

// Feature 248 (design §4.1/§4.2) — CONTRATO COMPARTIDO del cotizador: schemas zod de entrada
// de las DOS superficies y DTOs de salida.
//
// ⛔ MODULO DE TIPOS Y TABLAS PURAS. No importa `repositories/`, `services/`, `@/lib/db`,
// `next/headers` NI NADA DE DINERO (`ingreso-ordenex`, `TarifaVigentePorTienda`, `prisma.tarifa`).
// Dos motivos, ambos duros:
//
//   1. el Client Component de la cascada publica importa de aqui el tipo del arbol geografico,
//      y cualquiera de esos imports lo convertiria en codigo de servidor (mismo criterio que
//      `lib/types/rastreo-publico.ts:1-8`);
//   2. R10 — este modulo esta en el grafo de imports de la Server Action publica, y ese grafo
//      NO PUEDE ALCANZAR el resolver de tarifas ni la aritmetica monetaria, ni siquiera para
//      declarar un tipo. Una guardia estatica lo mide.
//
// Por eso TODO importe es `string` (money-safe, escala 2, `ROUND_HALF_UP` aguas arriba, R29):
// aqui no se hace aritmetica, se transporta el resultado de la que hace `ingreso-ordenex`.

/* -------------------------------------------------------------------------- */
/* 1. Catalogo geografico PUBLICO — sin zonas (D13/R7)                          */
/* -------------------------------------------------------------------------- */

/**
 * D13 — el arbol provincia → canton → distrito que el Server Component de `/cotizador` lee y
 * pasa por props a la cascada (R9). Cero round-trips, cero endpoint publico de catalogo nuevo.
 *
 * ⛔ NO LLEVA `zona` NI `esCentral`, y esa ausencia es el requisito (R7), no una simplificacion:
 * `listarArbolGeografico` (`lib/actions/geografia.ts`) NO sirve para esto porque es `maestro`-only
 * y expone la zona de cada distrito.
 */
export interface DistritoPublico {
  readonly id: string;
  readonly nombre: string;
}

export interface CantonPublico {
  readonly id: string;
  readonly nombre: string;
  readonly distritos: readonly DistritoPublico[];
}

export interface ProvinciaPublica {
  readonly id: string;
  readonly nombre: string;
  readonly cantones: readonly CantonPublico[];
}

/** Ordenado alfabeticamente en los tres niveles (lo ordena el repositorio, no la UI). */
export type ArbolGeograficoPublico = readonly ProvinciaPublica[];

/* -------------------------------------------------------------------------- */
/* 2. Entrada de la superficie PUBLICA (design §4.1)                            */
/* -------------------------------------------------------------------------- */

const MENSAJE_PROVINCIA = "Elegí una provincia.";
const MENSAJE_CANTON = "Elegí un cantón.";
const MENSAJE_DISTRITO = "Elegí un distrito.";

/**
 * R8 — TRES CAMPOS Y NI UNO MAS. El schema **no declara ninguna clave de tienda** (ni `tiendaId`,
 * ni email, ni api key), asi que un parametro asi en la entrada se ignora POR CONSTRUCCION: zod
 * lo descarta al parsear y nunca llega al service. La ausencia es el mecanismo, no la disciplina.
 *
 * D1 — la entrada es el TRIO DE NOMBRES, el mismo con el que la carga por API key identifica la
 * geografia (`BulkOrdenService`): un integrador cotiza con lo mismo con lo que despues carga.
 */
export const consultaCoberturaSchema = z.object({
  provincia: z.string({ error: MENSAJE_PROVINCIA }).trim().min(1, MENSAJE_PROVINCIA),
  canton: z.string({ error: MENSAJE_CANTON }).trim().min(1, MENSAJE_CANTON),
  distrito: z.string({ error: MENSAJE_DISTRITO }).trim().min(1, MENSAJE_DISTRITO),
});

export type ConsultaCobertura = z.infer<typeof consultaCoberturaSchema>;

/* -------------------------------------------------------------------------- */
/* 3. Salida de la superficie PUBLICA (design §4.1, R6/R7)                      */
/* -------------------------------------------------------------------------- */

/**
 * R6/R7 — la proyeccion estrecha que emite la Server Action publica. **Ni un campo mas.**
 *
 * Sin `esCentral`, sin id de zona, sin id de tarifa, sin id de tienda y **sin ningun importe**:
 * ni monto, ni porcentaje, ni total, ni campo del que se pueda derivar uno por diferencia (R10).
 * Una guardia compara estas claves contra un literal firmado.
 */
export type ResultadoCoberturaPublica =
  | { readonly estado: "cubierto"; readonly zonaNombre: string } // R2
  | { readonly estado: "sin_cobertura" } // R3
  | { readonly estado: "no_determinado" } // R4 (>1 zona)
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> }; // R5

/**
 * EL PUNTO ARQUITECTONICO DE LA FEATURE (design §1).
 *
 * `CoberturaService` resuelve UNA cosa —¿que zona cubre este distrito?— y su respuesta de
 * DOMINIO lleva lo que el negocio necesita: el id de la zona, su nombre y `esCentral`, porque
 * `CotizadorService` (canal por API key) usa `esCentral` para elegir la COLUMNA del flete y
 * necesita distinguir los tres estados crudos.
 *
 * Pero la superficie publica NO PUEDE VER NADA DE ESO (R7). En vez de tener dos servicios —uno
 * que quita campos, y quitar es una operacion que se olvida— hay **un solo dominio y dos
 * lecturas**: el resultado de dominio y esta proyeccion, que es el unico tipo que cruza hacia
 * el navegador. El campo peligroso no se borra en el borde: no existe en el DTO.
 */
export type ResultadoCobertura =
  | {
      readonly estado: "cubierto";
      readonly distritoId: string;
      readonly zonaId: string;
      readonly zonaNombre: string;
      readonly esCentral: boolean;
    }
  | { readonly estado: "sin_cobertura" }
  | { readonly estado: "no_determinado"; readonly cuantas: number }
  | { readonly estado: "validation_error"; readonly campos: Record<string, string> };

/** Proyecta el resultado de dominio al DTO publico. Funcion total: cubre los cuatro estados. */
export function aCoberturaPublica(resultado: ResultadoCobertura): ResultadoCoberturaPublica {
  switch (resultado.estado) {
    case "cubierto":
      // R7 — SOLO el nombre. `distritoId`, `zonaId` y `esCentral` se quedan del lado del dominio.
      return { estado: "cubierto", zonaNombre: resultado.zonaNombre };
    case "sin_cobertura":
      return { estado: "sin_cobertura" };
    case "no_determinado":
      // R4 — `cuantas` NO sale: contar zonas ya es contar estructura interna, y el publico no
      // tiene por que enterarse de que el dato esta inconsistente.
      return { estado: "no_determinado" };
    case "validation_error":
      return { estado: "validation_error", campos: resultado.campos };
  }
}

/**
 * El bloque de cobertura que viaja en la respuesta del canal por API key (§4.2). Es el MISMO
 * DTO publico menos `validation_error`, que ahi no es un estado del cuerpo sino un 422 (R14).
 */
export type CoberturaBloque = Exclude<ResultadoCoberturaPublica, { estado: "validation_error" }>;

/* -------------------------------------------------------------------------- */
/* 4. Entrada del canal por API key (design §4.2)                               */
/* -------------------------------------------------------------------------- */

const MENSAJE_MONTO = "monto_cobrar debe ser un importe con hasta 2 decimales (ej. \"25000.00\").";
const MENSAJE_CANTIDAD = `cantidad debe ser un entero entre ${cotizadorConfig.CANTIDAD_MIN} y ${cotizadorConfig.CANTIDAD_MAX}.`;
const MENSAJE_COBRA_COMISION = "cobra_comision debe ser booleano.";

/**
 * R29 — el monto llega como CADENA money-safe y se queda como cadena: ni `number`, ni
 * `parseFloat`, ni coercion. `25000.00`, `25000.0`, `25000` y `0` valen; `25.000,00`, `1e5`,
 * `-100` y `1.005` no. La normalizacion a escala 2 la hace el service con `Prisma.Decimal`,
 * que es quien tiene derecho a tocar dinero.
 */
const MONTO_MONEY_SAFE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Borde del canal por API key. Las claves van en `snake_case` porque es el contrato PUBLICADO
 * (mismo criterio que la carga por API), no el estilo interno del repo.
 *
 * R15 — aqui NO hay ninguna clave de tienda: la tienda es `actor.usuarioId`, resuelto por la
 * API key. Igual que en la superficie publica, la ausencia es el mecanismo.
 */
export const cotizacionApiSchema = z.object({
  provincia: z.string({ error: MENSAJE_PROVINCIA }).trim().min(1, MENSAJE_PROVINCIA),
  canton: z.string({ error: MENSAJE_CANTON }).trim().min(1, MENSAJE_CANTON),
  distrito: z.string({ error: MENSAJE_DISTRITO }).trim().min(1, MENSAJE_DISTRITO),
  monto_cobrar: z.string({ error: MENSAJE_MONTO }).trim().regex(MONTO_MONEY_SAFE, MENSAJE_MONTO),
  // R25/R27/D16 — opcional con default; el rango sale de `lib/config/cotizador.ts`, no de un
  // literal aqui. `int()` es lo que rechaza `1.5`; `min`/`max` rechazan `0` y `1001`. Los
  // extremos 1 y 1000 se ACEPTAN.
  cantidad: z
    .number({ error: MENSAJE_CANTIDAD })
    .int(MENSAJE_CANTIDAD)
    .min(cotizadorConfig.CANTIDAD_MIN, MENSAJE_CANTIDAD)
    .max(cotizadorConfig.CANTIDAD_MAX, MENSAJE_CANTIDAD)
    .default(cotizadorConfig.CANTIDAD_POR_DEFECTO),
  // R33/D15 — ausente vale `true`, que es el CASO CARO (añade comision COD + su IVA). Una
  // cotizacion que se equivoca hacia arriba hace que la factura posterior sea menor o igual a
  // lo cotizado; el default contrario produciria la sorpresa desagradable.
  cobra_comision: z.boolean({ error: MENSAJE_COBRA_COMISION }).default(true),
});

/** Entrada YA validada: `cantidad` y `cobra_comision` son obligatorias aqui (tienen default). */
export type CotizacionApiEntrada = z.infer<typeof cotizacionApiSchema>;

/* -------------------------------------------------------------------------- */
/* 5. Salida del canal por API key (design §4.2)                                */
/* -------------------------------------------------------------------------- */

/**
 * R18/R19/R33 — los cuatro conceptos del escenario ENTREGADA, por separado, mas el costo total
 * y el neto de la tienda.
 *
 * `comisionCod` e `ivaComisionCod` son OPCIONALES y esa opcionalidad es el requisito: con
 * `cobra_comision: false`, `derivarIngresoOrden` los deja AUSENTES (no en `"0.00"`), y esta
 * respuesta respeta la distincion — un concepto ausente y uno en cero no dicen lo mismo.
 */
export interface ImportesEntregada {
  readonly flete: string;
  readonly ivaFlete: string;
  readonly comisionCod?: string;
  readonly ivaComisionCod?: string;
  /** Suma de los conceptos presentes (flete + IVA + comision + IVA), money-safe. */
  readonly costoTotal: string;
  /** R19 — `pagoTiendaOrdenex(montoCobrar, flete+IVA, comision+IVA)`. */
  readonly netoTienda: string;
}

/**
 * R20/R21 — el escenario DEVUELTA: flete de devolucion y su IVA. **Sin comision COD, sin IVA de
 * comision y sin monto COD a recibir**: una devolucion no recauda.
 */
export interface ImportesDevuelta {
  readonly fleteDevolucion: string;
  readonly ivaFleteDevolucion: string;
  readonly costoTotal: string;
  /**
   * R21/R22 — NEGATIVO: `-(fleteDevolucion + ivaFleteDevolucion)`, obtenido NEGANDO lo que ya
   * devolvio `derivarIngresoOrden({ resultado: "devuelta" })`, sin recalcular nada.
   *
   * ⚠ ESTE NUMERO NO EXISTE EN EL CIERRE. `pagoTiendaOrdenex` no descuenta el flete de
   * devolucion (su docstring lo dice): una devolucion no recauda COD, asi que no aporta al total
   * general. Es una lectura del cotizador («cuanto te cuesta si vuelve»), no un asiento; no debe
   * cuadrarse contra ninguna linea de cierre.
   */
  readonly netoTienda: string;
}

/**
 * R26/D7 — un escenario se publica DOS veces: por orden y por las N. El `total` es el unitario
 * YA REDONDEADO multiplicado por N, no el redondeo final de una multiplicacion sin redondear:
 * el cierre acumula valores ya redondeados por gestion (`agregarIngresosPorConcepto`), asi que
 * cualquier otra cosa daria un total que no cuadra con lo que se factura orden por orden.
 */
export interface EscenarioCotizacion<T> {
  readonly unitario: T;
  readonly total: T;
}

/** Respuesta con costos: la cobertura resolvio EXACTAMENTE una zona (R16 no aplica). */
export interface CotizacionConCostos {
  readonly cobertura: CoberturaBloque;
  /** R30 — `false` = la tienda no tiene tarifa vigente y los conceptos van en `"0.00"`. */
  readonly tarifaVigente: boolean;
  readonly cantidad: number;
  /** Eco money-safe del monto COD aplicado, normalizado a escala 2. */
  readonly montoCobrar: string;
  /** R33 — eco del parametro aplicado (con su default resuelto). */
  readonly cobraComision: boolean;
  /** R28/D8 — supuesto de la cotizacion multiple; ver `textoSupuesto`. */
  readonly supuesto: string;
  readonly escenarios: {
    readonly entregada: EscenarioCotizacion<ImportesEntregada>;
    readonly devuelta: EscenarioCotizacion<ImportesDevuelta>;
  };
}

/**
 * R16 — cobertura no resuelta (0 o >1 zonas): 200 con el bloque de cobertura y **sin bloque de
 * costos**, sin elegir una zona arbitraria y **sin tocar `tarifas`**.
 */
export interface CotizacionSinCostos {
  readonly cobertura: CoberturaBloque;
  readonly costos: null;
}

export type CotizacionRespuesta = CotizacionConCostos | CotizacionSinCostos;

/**
 * R28/D8 — texto FIJO del supuesto, con la cantidad interpolada. No es decoracion: sin el, un
 * integrador multiplicaria una canasta heterogenea y la comision COD saldria mal (es un % del
 * monto, y el % de la suma no es la suma de los % redondeados). Cotizar canastas heterogeneas
 * es OTRO alcance.
 */
export function textoSupuesto(cantidad: number): string {
  return cantidad === 1
    ? "la cotización corresponde a 1 orden con ese distrito y ese monto a cobrar"
    : `las ${cantidad} órdenes comparten distrito y monto a cobrar`;
}
