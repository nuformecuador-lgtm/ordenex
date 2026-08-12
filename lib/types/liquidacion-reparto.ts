import { z } from "zod";
import type { CierreEstado } from "@prisma/client";
import {
  camposComunesDelPago,
  exigirReferenciaEnPagoElectronico,
  montoLiquidacionSchema,
} from "@/lib/types/liquidacion";

// Feature 205 (T4.1, design §7.1/§7.2) — contratos I/O del REPARTO de un pago entre los cierres
// pendientes de un mensajero, y los schemas zod del BORDE.
//
// Money-critical: ningun `number` cruza la frontera salvo los dos CARDINALES del recorte
// (`tope`, `enVentana`, `fuera`), que cuentan CIERRES y no dinero. Todo monto viaja como STRING
// de escala 2 y se convierte a `Prisma.Decimal` solo en el servidor. Cero `Number(`, cero
// `parseFloat` y cero `parseInt` en este archivo y en sus tests.
//
// Los DTO NO emiten identificadores de PERSONAS (R48): el mensajero viaja por su NOMBRE. El
// `cierreId` SI viaja, y es la unica excepcion deliberada: es lo que hace direccionable el
// detalle del cierre (R44, design §4).
//
// **Nada se reescribe aqui.** El monto, la referencia, la nota y la fecha son literalmente los
// campos del pago de la 172 (`camposComunesDelPago`), y la referencia obligatoria en pago
// electronico es su mismo `superRefine`. Un schema propio con «las mismas» reglas seria dos
// sitios que pueden divergir el dia que una de ellas cambie.

// ── Schemas del borde ──────────────────────────────────────────────────────────────────────

/**
 * R9/R47 — el borde de la PREVISUALIZACION (solo lectura).
 *
 * `.strict()` es la barrera LITERAL de R9: `cierreId` **no existe** en este schema, asi que una
 * peticion que intente elegir contra que cierre se imputa muere aqui, en el borde, sin tocar
 * datos. No es una comprobacion que alguien tenga que acordarse de escribir: es la ausencia del
 * campo mas el `.strict()`.
 *
 * `monto` es OPCIONAL: sin el, la previsualizacion devuelve el conjunto imputable y sus avisos
 * (es lo que abre el dialogo y decide si el boton se habilita); con el, ademas las imputaciones
 * que produciria (design §6.1).
 */
export const previsualizarRepartoSchema = z
  .object({
    mensajeroId: z.string().uuid(),
    monto: montoLiquidacionSchema.optional(),
  })
  .strict();

/**
 * R9/R27/R47/R58 — el borde del REGISTRO del reparto.
 *
 * Los seis campos comunes son los del pago de la 172 SIN COPIAR: misma clave de idempotencia
 * (acuñada al ABRIR el formulario, R27), mismo tope de monto derivado de la columna, misma
 * referencia con su `.trim()` y su maximo, misma nota y misma fecha que no puede ser futura.
 *
 * Lo unico propio es `mensajeroId`: se paga A UNA PERSONA y el servidor decide contra que
 * cierres (R9). Y el metodo, la referencia y la fecha se capturan UNA sola vez para el reparto
 * entero — no hay forma de expresar una por cierre, que es la mitad de R58 que vive en el
 * contrato y no en el codigo.
 */
export const registrarRepartoMensajeroSchema = z
  .object({ ...camposComunesDelPago, mensajeroId: z.string().uuid() })
  .strict()
  .superRefine(exigirReferenciaEnPagoElectronico);

export type PrevisualizarRepartoInput = z.infer<typeof previsualizarRepartoSchema>;
export type RegistrarRepartoMensajeroInput = z.infer<typeof registrarRepartoMensajeroSchema>;

// ── DTOs de salida (frontera Server Action -> cliente). Montos SIEMPRE STRING (R46) ─────────

/**
 * R32/R33 — una imputacion tal y como se PREVE: a que cierre, cuanto, y que le queda despues.
 *
 * `parcial` y `pendienteDespues` los calcula el SERVIDOR (R34): el cliente no resta ni compara
 * importes, solo pinta lo que recibe.
 */
export type ImputacionPrevistaDTO = {
  cierreId: string; // R48: el id del CIERRE si cruza — es el enlace a su detalle (R44)
  solicitadoAt: string; // ISO — la antiguedad, para nombrar el cierre en pantalla
  pendienteActual: string; // STRING 2 dec
  monto: string; // STRING 2 dec
  pendienteDespues: string; // STRING 2 dec
  parcial: boolean;
};

/**
 * R36 — CUANTOS cierres del mensajero no pueden recibir imputacion, por el estado que los deja
 * fuera: «9 rechazados, 3 solicitados». Solo llegan los estados con al menos un cierre.
 *
 * **Es un CONTEO, no una lista, y es una decision de negocio tomada a proposito.** El aviso de
 * R36 existe para transmitir «hay dinero que no estas pagando aqui, y por que»; el INVENTARIO de
 * esos cierres vive en `/cierres-admin`, que es adonde lleva el enlace de esta pantalla. Con una
 * fila por cierre la respuesta no tenia tope y un mensajero con dos años de cierres rechazados
 * se los llevaba todos al dialogo. Contado por estado queda acotado **por construccion**: el
 * tamaño depende del numero de valores de `CierreEstado`, no del numero de cierres.
 *
 * **LO QUE SE PIERDE, y se acepta:** el aviso ya NO puede nombrar un cierre concreto —antes
 * viajaba su `solicitadoAt` justamente para eso—. Es el precio de que la respuesta este acotada.
 * Devolver otra vez la lista para «poder nombrarlos» deshace la decision, no arregla un olvido.
 *
 * **NO lleva importe, y no es un olvido** (design §7.2, §10.2): un cierre no aprobado no ha
 * devengado nada todavia —el libro se escribe AL APROBAR— y la 172 enseña `null` como su
 * pendiente a proposito. Inventar aqui una cifra contradiria esa decision y pondria en pantalla
 * un dinero que nadie debe todavia. Un conteo no es un monto: `cantidad` es un CARDINAL —cuenta
 * cierres— y por eso viaja como `number`, igual que los tres del recorte.
 */
export type ExcluidosPorEstadoDTO = {
  estado: CierreEstado;
  cantidad: number;
};

/**
 * R56 — el RECORTE por el tope de R53, con las tres cifras que la pantalla tiene que decir. El
 * cliente lo PINTA; no lo deduce ni lo recalcula.
 *
 * `tope`, `enVentana` y `fuera` son CARDINALES (cuentan cierres, no dinero) y por eso viajan
 * como `number`; `montoFuera` es dinero y viaja como STRING de escala 2.
 */
export type RecorteDTO = {
  aplicado: boolean; // hay cierres imputables FUERA de la ventana
  tope: number; // el maximo vigente, para poder nombrarlo en pantalla
  enVentana: number; // cuantos cierres entran
  fuera: number; // cuantos quedan recortados
  montoFuera: string; // STRING 2 dec — cuanto suman los recortados
};

/**
 * R32-R38/R56/R57 — lo que la previsualizacion devuelve. Todo derivado en el SERVIDOR.
 *
 * Los dos avisos son DOS campos distintos y no se pueden fundir (design §8):
 *  - `recorte`: deuda pagable AQUI MISMO, en otro reparto (el tope cortó la ventana);
 *  - `deudaNoImputable`: deuda que esta pantalla NO sabe pagar porque no cuelga de ningun cierre.
 */
export type PrevisualizacionRepartoDTO = {
  mensajeroNombre: string; // R48: NOMBRE, nunca el id de la persona
  imputable: string; // el de la VENTANA: es el `disponible` del dialogo (R14/R38)
  imputableTotal: string; // el de TODOS los imputables (= imputable + recorte.montoFuera)
  cuentaPorPagar: string; // lo que la fila de la pantalla enseña como deuda (R37)
  /** R37 ya RESUELTO en el servidor: el cliente no compara importes. */
  deudaNoImputable: {
    hay: boolean; // imputableTotal < cuentaPorPagar
    monto: string; // STRING 2 dec — la parte que esta pantalla no puede imputar
  };
  recorte: RecorteDTO; // R56 — distinto y separado del aviso de arriba
  imputaciones: ImputacionPrevistaDTO[]; // vacio si la peticion no trajo monto
  sobrante: string; // STRING 2 dec — lo que el importe excede a la ventana
  excede: boolean; // R38, resuelto en el servidor
  excluidos: ExcluidosPorEstadoDTO[]; // R36 — CONTEO por estado, jamas la lista de cierres
};

/** R25 — una imputacion tal y como se APLICO. */
export type ImputacionAplicadaDTO = {
  cierreId: string; // R44: el enlace al detalle del cierre
  monto: string; // STRING 2 dec
  pendienteDespues: string; // STRING 2 dec
};

/**
 * R25 — el reparto REALMENTE aplicado, recalculado bajo bloqueo. No es la previsualizacion
 * confirmada: puede diferir de ella, y ese es justo el punto (design §6.1).
 */
export type RepartoAplicadoDTO = {
  totalImputado: string; // STRING 2 dec — Σ de lo imputado
  /**
   * Lo que SIGUE debiendose por cierres tras el reparto: el TOTAL imputable, no el de la
   * ventana. Tras un reparto con recorte es > 0 A PROPOSITO, y es lo que dice que hay que
   * registrar otro (design §2.5.1).
   */
  restanteImputable: string; // STRING 2 dec
  imputaciones: ImputacionAplicadaDTO[];
};

// ── Resultados de las dos Server Actions ───────────────────────────────────────────────────

/**
 * Resultado de PREVISUALIZAR. `no_encontrado` es el mensajero que no existe; no hay rama de
 * exceso: un importe que no cabe se responde `ok` con `excede: true` y sus cifras, que es lo que
 * la pantalla necesita para avisar ANTES de que el usuario confirme (R38).
 */
export type PrevisualizarRepartoResult =
  | { status: "ok"; previsualizacion: PrevisualizacionRepartoDTO }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

/**
 * Resultado de REGISTRAR el reparto. Son los MISMOS nombres que `RegistrarPagoResult` (design
 * §7.2) para que la pantalla no tenga que aprender un vocabulario nuevo:
 *
 *  - `ya_registrado` (R28) devuelve el reparto ORIGINAL, reconstruido por `reparto_id`;
 *  - `excede` (R14) informa del disponible **de la ventana**, que es lo que un reparto admite;
 *  - `sin_saldo` (R15) es «no hay nada que imputar»;
 *  - NO existe `cierre_no_aprobado`: la peticion no elige cierre (R9), asi que no hay ningun
 *    cierre concreto del que informar. Un cierre que deja de estar aprobado bajo bloqueo
 *    simplemente no recibe (R24) y la ventana ENCOGE (design §2.5.5).
 */
export type RegistrarRepartoResult =
  | { status: "ok"; reparto: RepartoAplicadoDTO }
  | { status: "ya_registrado"; reparto: RepartoAplicadoDTO }
  | { status: "excede"; disponible: string }
  | { status: "sin_saldo" }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
