import { money } from "@/lib/config/moneda";

/**
 * ⭑ FICHA 431 — TEXTOS de la marca de conciliación de una consolidación de bodega.
 *
 * Módulo PURO (sin React): `docs/conventions` manda los textos de UI fuera del componente, e
 * i18n-ready — nada de literales incrustados en el JSX. Las que llevan un dato dentro son
 * FUNCIONES y no concatenaciones sueltas, para que el día que haya i18n el dato siga siendo un
 * parámetro.
 *
 * Vive en `components/shared/` porque lo montan DOS pantallas con la misma API: el desglose de
 * `/wallet/satelites` y la cola de `/cierres-admin` (`docs/architecture.md`: se promueve cuando
 * dos features lo necesitan igual). El vocabulario de ESTADO —«Pendiente de conciliar»,
 * «Recibido», «Recibido incompleto»— NO se redefine aquí: sale de `cierre-labels.ts`, que es
 * donde la guardia de vocabulario lo ancla a mano.
 */

/** La acción, por lo que hace y no por el estado al que lleva. */
export const CONCILIACION_ACCION = {
  /** Sobre una consolidación sin conciliar. */
  marcar: "Marcar recibido",
  /** Sobre una que llegó incompleta: no se vuelve a marcar, se corrige el monto. */
  corregir: "Corregir",
  /** R12 — deshacer la marca. NO dice «Rechazar»: no rechaza nada, sólo borra la marca. */
  desmarcar: "Desmarcar",
  cancelar: "Cancelar",
} as const;

/** El diálogo de marcar/corregir. */
export const MARCAR_RECIBIDO_TEXTO = {
  titulo: CONCILIACION_ACCION.marcar,
  tituloCorregir: "Corregir el monto recibido",
  /**
   * Quién consolidó y cuándo. Es lo que identifica el bulto del que se habla cuando una bodega
   * tiene varias consolidaciones abiertas — desde esta ficha puede tener cuantas quiera.
   */
  descripcion: (bodega: string, fecha: string) =>
    `Consolidación de ${bodega} del ${fecha}.`,
  /** Lo que la bodega DECLARÓ que metió en el bulto. No se edita: es un dato, no una entrada. */
  declarado: "Declarado por la bodega",
  montoRecibido: "Monto recibido",
  /**
   * La pista del campo, palabra por palabra la del diseño aprobado. Dice las dos cosas que hay
   * que saber: que el valor ya está puesto, y cuándo hay que tocarlo.
   */
  montoAyuda: "Viene con lo declarado. Cambialo solo si contaste una cantidad distinta.",
  nota: "Nota",
  notaAyuda: "Opcional. Por ejemplo: «faltaron ₡15.000, entran el lunes».",
  confirmar: CONCILIACION_ACCION.marcar,
} as const;

/** Errores de campo que este formulario puede levantar por sí solo, antes de enviar. */
export const MARCAR_RECIBIDO_ERROR = {
  monto: "Escribí un monto válido, mayor que cero y con dos decimales como máximo.",
  notaLarga: (max: number) => `La nota no puede pasar de ${max} caracteres.`,
} as const;

/** Lo que responde el servidor, traducido a algo accionable. */
export const CONCILIACION_RESPUESTA = {
  marcada: (monto: string) => `Marcada como recibida por ${money(monto)}.`,
  revertida: "Marca deshecha. La consolidación vuelve a estar pendiente de conciliar.",
  /** R11 — alguien la marcó (o la desmarcó) mientras este diálogo estaba abierto. */
  conflicto: "Esta consolidación ya cambió de estado. Actualizando la lista.",
  noEncontrada: "Esta consolidación ya no está disponible.",
  forbidden: "No tenés permiso para conciliar consolidaciones de bodega.",
  unauthenticated: "Tu sesión expiró. Iniciá sesión de nuevo.",
  fallo: "No se pudo completar la operación. Intentá de nuevo.",
} as const;

/** Tope de la nota, el MISMO que el `.max(500)` del schema del borde. */
export const CONCILIACION_NOTA_MAX = 500;

/**
 * ⚠️ LA NOTA QUE IMPIDE QUE «DESMARCAR» SE LEA COMO UN MOVIMIENTO DE DINERO.
 *
 * Va al pie del desglose, no escondida en un tooltip. Sin ella, «Desmarcar» junto a un importe
 * se lee como devolver plata, y quien lo piense no lo va a pulsar nunca — dejando una marca
 * equivocada viva para siempre, que es justo lo que D6 quiso evitar al hacerla reversible.
 */
export const DESMARCAR_NO_MUEVE_DINERO_TITULO = "Desmarcar no mueve dinero.";
export const DESMARCAR_NO_MUEVE_DINERO_NOTA =
  "La marca es informativa: dice si el efectivo llegó, no lo contabiliza. Por eso se puede " +
  "deshacer si alguien marcó por error — y queda registrado quién marcó y quién deshizo.";
