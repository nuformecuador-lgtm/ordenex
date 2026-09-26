import { money } from "@/lib/config/moneda";
import type { SaldoTiendaDTO } from "@/lib/types/wallet-tienda";

import { SALDO_SIGNO_LABEL } from "@/app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label";

// FICHA 458-C (T C.1–C.3, design §4.1/§4.4/§5.1) — los textos del diálogo ÚNICO «Registrar un
// movimiento». Fuera del JSX (docs/conventions): una futura pasada de i18n tiene UN solo sitio.
//
// Los textos que heredan de los diálogos anteriores (381, 459, 457) se conservan byte a byte: son lo
// que la oficina ya lee, y cambiarlos aquí sería cambiar la wallet por la puerta de atrás. Los
// nuevos siguen la regla de la 461 §7: desde Ordenex, quién le paga a quién, sin siglas.
//
// Money-safe (R90): ningún texto calcula un importe. Los que llevan dinero reciben el STRING que
// devolvió el SERVIDOR y lo formatean con `money`.

export const REGISTRAR_MOVIMIENTO_TEXTO = {
  /** El botón que abre el diálogo (R37). */
  abrir: "Registrar un movimiento",
  confirmar: "Registrar",
  catalogo: "Qué movimiento es",
  /** R37/R38 — el gasto fijo no se registra a mano: se cobra desde su plantilla. */
  plantillas: "Los gastos fijos no se registran aquí: se cobran solos desde sus plantillas.",
  plantillasEnlace: "Ver las plantillas de gasto fijo",
  forbidden: "No tenés permiso para registrar movimientos.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  /** El aviso de éxito de los conceptos de la caja de la 334, byte a byte (R11 de la 334). */
  exitoCaja: "Movimiento registrado correctamente.",
} as const;

/** Rótulos y avisos de los campos comunes. */
export const CAMPO_TEXTO = {
  monto: "Monto",
  montoInvalido: "El monto debe ser un número mayor que 0.",
  fecha: "Fecha",
  fechaAyuda:
    "Poné el día en que ocurrió. Podés elegir un día anterior si lo estás registrando después.",
  fechaVacia: "Elegí la fecha.",
  fechaFutura: "La fecha no puede ser posterior a hoy.",
  motivoVacio: "El motivo es obligatorio.",
  descripcionVacia: "La descripción es obligatoria.",
  /** R42 — «a quién», texto libre (H2: sin catálogo de personas ni de proveedores). */
  aQuien: "A quién se le pagó",
  aQuienOpcional: "A quién (opcional)",
  aQuienMarcador: "Ej. nombre de la persona o del proveedor",
  aQuienAyuda: "La persona o el proveedor, como lo escribirías en un recibo.",
  aQuienVacio: "Escribí a quién se le pagó.",
  referenciaOpcional: "Referencia (opcional)",
  referenciaOpcionalAyuda: "Número de SINPE, de transferencia o de factura, si lo hay.",
} as const;

/** R41 — la cuenta, con un buscador por nombre (`SelectorBuscable`). */
export const CUENTA_TEXTO = {
  tienda: {
    etiqueta: {
      cobro_tienda: "Tienda a la que se le cobra",
      pago_por_cuenta_tienda: "Tienda por la que se paga",
      abono_tienda: "Tienda que paga",
      pago_tienda: "Tienda a la que se le paga",
    },
    elegir: "Elegí la tienda",
    buscar: "Buscar la tienda",
    buscarMarcador: "Nombre de la tienda",
    cargando: "Cargando las tiendas…",
    error: "No se pudieron cargar las tiendas",
    vacio: "No hay tiendas activas con ese nombre",
    hayMas: "Se muestran solo las primeras tiendas.",
    sinElegir: "Elegí la tienda.",
    catalogoCaido:
      "No se pudo cargar la lista de tiendas, así que este movimiento no se puede registrar ahora mismo. Cerrá y volvé a abrir para reintentarlo; los otros conceptos siguen funcionando.",
  },
  mensajero: {
    etiqueta: "Mensajero al que se le paga",
    elegir: "Elegí el mensajero",
    buscar: "Buscar el mensajero",
    buscarMarcador: "Nombre del mensajero",
    cargando: "Cargando los mensajeros…",
    error: "No se pudieron cargar los mensajeros",
    vacio: "No hay mensajeros activos con ese nombre",
    hayMas: "Se muestran solo los primeros mensajeros.",
    sinElegir: "Elegí el mensajero.",
    catalogoCaido:
      "No se pudo cargar la lista de mensajeros, así que este pago no se puede registrar ahora mismo. Cerrá y volvé a abrir para reintentarlo; los otros conceptos siguen funcionando.",
  },
} as const;

/** Pistas bajo la cuenta, por concepto (textos de la 381, la 459 y la 457, byte a byte). */
export const PISTA_CUENTA = {
  cobro_tienda:
    "El cobro se descuenta del saldo a favor de la tienda y pasa a ser ganancia de Ordenex. Si la tienda no tiene saldo, queda en contra y se cobra cuando la gestión le vuelva a generar dinero a favor.",
  pago_por_cuenta_tienda:
    "Si la tienda no tiene saldo suficiente, su saldo queda en contra: ella le deberá ese dinero a Ordenex.",
  abono_tienda: "Solo se admite si la tienda tiene saldo en contra, y hasta lo que debe.",
  pago_tienda: "Solo se admite hasta lo que Ordenex le debe a la tienda.",
  pago_mensajero: "El importe se reparte entre sus cierres pendientes.",
} as const;

/** FICHA 459 — el pago de un gasto de una tienda: beneficiario, método y referencia. */
export const PAGO_TEXTO = {
  beneficiario: "A quién se le pagó",
  beneficiarioPlaceholder: "Ej. Facebook, Jet Cargo, nombre de la persona",
  sinBeneficiario: "Escribí a quién se le pagó.",
  metodo: "Método de pago",
  metodoPlaceholder: "Elegí el método",
  sinMetodo: "Elegí el método de pago.",
  referencia: "Referencia",
  referenciaHint: "Obligatoria en SINPE y transferencia.",
  sinReferencia: "La referencia es obligatoria en SINPE y transferencia.",
} as const;

/** FICHA 459 — el saldo inicial o aporte de capital. */
export const APORTE_TEXTO = {
  clase: "Qué es",
  sinClase: "Elegí si es el saldo inicial o un aporte de capital.",
  clases: [
    {
      value: "saldo_inicial",
      label:
        "Saldo inicial — el dinero que Ordenex tenía al empezar a usar la app. Solo puede haber uno.",
    },
    { value: "aporte", label: "Aporte de capital — dinero de Ordenex que entra después." },
  ],
  nombreClase: { saldo_inicial: "Saldo inicial", aporte: "Aporte de capital" },
  yaHaySaldoInicial:
    "Ya hay un saldo inicial registrado y solo puede haber uno. Si hay que cambiarlo, anulá el vigente desde el libro de la caja.",
  registrado: (clase: "saldo_inicial" | "aporte", monto: string) =>
    `Registrado. ${APORTE_TEXTO.nombreClase[clase]} de ${money(monto)}.`,
} as const;

/** R48 — el saldo del SERVIDOR con su signo; si queda en contra, en palabras (461 R54). */
function fraseSaldoTienda(tienda: string, saldo: SaldoTiendaDTO, debe: string): string {
  return (
    `El saldo de ${tienda} queda en ${money(saldo.saldo)} · ${SALDO_SIGNO_LABEL[saldo.signo]}.` +
    (saldo.signo === "negativo" ? ` ${debe}` : "")
  );
}

/** Los avisos de éxito y de rechazo que dependen de la respuesta del SERVIDOR. */
export const RESPUESTA_TEXTO = {
  cobro: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Cobro registrado. ${fraseSaldoTienda(tienda, saldo, "La tienda le debe ese dinero a Ordenex.")}`,
  pagoPorCuenta: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Pago registrado. ${fraseSaldoTienda(tienda, saldo, "La tienda le debe ese dinero a Ordenex.")}`,
  abono: (tienda: string, saldo: SaldoTiendaDTO) =>
    `Pago registrado. ${fraseSaldoTienda(tienda, saldo, "La tienda todavía le debe ese dinero a Ordenex.")}`,
  abonoYaRegistrado: (tienda: string, monto: string, saldo: SaldoTiendaDTO) =>
    `Este pago ya estaba registrado, por ${money(monto)}. ${fraseSaldoTienda(tienda, saldo, "La tienda todavía le debe ese dinero a Ordenex.")}`,
  sinDeuda: "Esta tienda no tiene saldo en contra: no hay nada que pagar.",
  excedeDeuda: (deuda: string) => `La tienda debe ${money(deuda)}: el pago no puede superar ese importe.`,
  /** 458-C — el pago de Ordenex a una tienda: lo que le queda a favor, del SERVIDOR. */
  pagoTienda: (tienda: string, monto: string, restante: string) =>
    `Pago de ${money(monto)} a ${tienda} registrado. Ordenex le sigue debiendo ${money(restante)}.`,
  sinSaldoTienda: "Esta tienda no tiene saldo a favor: no hay nada que pagar.",
  excedeSaldoTienda: (disponible: string) =>
    `Ordenex le debe ${money(disponible)} a esta tienda: el pago no puede superar ese importe.`,
  /** 458-C — el reparto al mensajero: lo imputado y lo que sigue debiéndose, del SERVIDOR. */
  pagoMensajero: (mensajero: string, total: string, restante: string) =>
    `Pago de ${money(total)} a ${mensajero} registrado. Ordenex le sigue debiendo ${money(restante)} por sus cierres.`,
  sinSaldoMensajero: "Este mensajero no tiene cierres pendientes de pago: no hay nada que pagar.",
  excedeSaldoMensajero: (disponible: string) =>
    `Se le pueden pagar hasta ${money(disponible)} por sus cierres pendientes: el pago no puede superar ese importe.`,
  noEncontrado: "No se encontró esa cuenta. Cerrá y volvé a abrir para elegirla de nuevo.",
} as const;

/** R74–R76 — el comprobante, opcional en todo concepto (H1). */
export const COMPROBANTE_CAMPO_TEXTO = {
  label: "Comprobante (opcional)",
  hint: "Imagen JPEG, PNG o WebP, o un PDF, de hasta 4 MB.",
  quitar: "Quitar el comprobante",
  noGuardado: "No se pudo guardar el comprobante, así que no se registró nada. Probá de nuevo.",
} as const;

/** R44–R47 — «Así queda». */
export const ASI_QUEDA_TEXTO = {
  titulo: "Así queda",
  inactivo: "Escribí el monto para ver cómo queda.",
  inactivoConCuenta: "Elegí la cuenta y escribí el monto para ver cómo queda.",
  cargando: "Calculando cómo queda…",
  /** R46 — sin respuesta del servidor no hay cifras: ni siquiera las de antes. */
  error:
    "No se pudo calcular cómo queda. Podés registrar igual: el servidor revisa el movimiento antes de guardarlo.",
  antes: "Antes",
  despues: "Después",
  /** R45 — la línea que el concepto no mueve se dice en palabras. */
  noCambia: "no cambia",
  cuentaTienda: (tienda: string) => `Saldo de ${tienda}`,
  cuentaMensajero: (mensajero: string) => `Lo que Ordenex le debe a ${mensajero}`,
  /** R47 — el saldo de la tienda queda en contra, con su signo, antes de confirmar. */
  saldoEnContra: (tienda: string, saldo: string) =>
    `Así, ${tienda} queda con el saldo en contra: ${money(saldo)}. Le deberá ese dinero a Ordenex.`,
  /** El tope lo decide el servidor (`superaDisponible`). */
  superaPagoTienda: "El monto supera lo que Ordenex le debe a esta tienda: no se va a poder registrar.",
  superaAbono: "El monto supera lo que la tienda le debe a Ordenex: no se va a poder registrar.",
} as const;
