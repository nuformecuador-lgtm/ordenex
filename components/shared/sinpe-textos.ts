/**
 * ⭑ FICHA 429 (T21/T22) — TODO EL TEXTO DE LA SUPERFICIE DEL SINPE, EN UN SOLO SITIO.
 *
 * POR QUE UN MODULO DE TEXTOS Y NO LAS CADENAS PEGADAS AL JSX. Las mismas frases se pintan en
 * TRES superficies —`/mi-bodega`, «SINPE por bodega» y el aviso del primer ingreso— y las tres
 * hablan del mismo dinero. Escritas tres veces divergen sin que nada se ponga rojo: una diria
 * «8 digitos» y otra «ocho digitos», y la que se corrija el dia del incidente no sera la que la
 * persona esta leyendo. Ademas deja el arbol listo para i18n sin tocar un componente.
 *
 * ⚠️ NO SE ESCRIBE «SLA» NI NINGUNA SIGLA DE OFICINA: aqui se le habla a quien cobra en la calle.
 */

/** El campo del numero: rotulo, pista y marcador de ejemplo. */
export const SINPE_CAMPO_NUMERO = {
  label: "Número SINPE",
  hint: "8 dígitos, empieza por 6, 7 u 8.",
  placeholder: "Ej: 88881111",
} as const;

/** El campo del titular. La pista dice DONDE mirarlo, no solo que se escriba algo. */
export const SINPE_CAMPO_NOMBRE = {
  label: "A nombre de",
  hint: "Tal como aparece en SINPE Móvil al teclear el número.",
  placeholder: "Ej: Ordenex CR S.A.",
} as const;

/** La tarjeta de `/mi-bodega`. */
export const SINPE_MI_BODEGA = {
  titulo: "SINPE de la bodega",
  ayuda:
    "Es el número al que tus clientes transfieren cuando pagan por SINPE. Lo usan todos los mensajeros de esta bodega.",
  guardar: "Guardar",
  cancelar: "Cancelar",
  /** Se completa con la fecha. Sin fecha, la bodega sigue con la semilla. */
  ultimaRevision: "Última revisión:",
  sinRevisar: "Nadie ha revisado este número todavía.",
} as const;

/**
 * El panel de la vista previa. ES LA PIEZA CENTRAL DE LA PANTALLA, no un adorno: convierte un
 * fallo mudo —un numero de ocho digitos valido pero ajeno— en uno visible, porque pone el numero
 * y el titular en la misma frase que va a leer el cliente.
 */
export const SINPE_PREVIEW = {
  chip: "Vista previa",
  titulo: "Lo que va a leer el cliente",
  pie: "Revisá el número y el nombre juntos. SINPE Móvil le muestra al cliente el titular al teclear el número: si no coincide con lo que dice el mensaje, no va a pagar.",
  /** Cuando la plantilla no está sincronizada no se inventa un texto: se dice que falta. */
  sinPlantilla:
    "No se pudo cargar el mensaje que reciben los clientes, así que no hay nada que comparar aquí. El número y el nombre de arriba se guardan igual.",
  /**
   * Qué es lo resaltado, dicho FUERA de la frase. Un rótulo metido dentro del mensaje partía la
   * oración en dos y, como el párrafo es región `aria-live`, se re-anunciaba entero en cada
   * tecla. Aquí se dice una vez y no estorba a la frase que el cliente va a leer.
   */
  leyendaMarcas: "Resaltados: el número SINPE y el titular.",
} as const;

/** El aviso de riesgo, en las dos pantallas. Dice el DAÑO, no «revise los datos». */
export const SINPE_AVISO_RIESGO = {
  titulo: "Un número mal escrito no da error",
  cuerpo:
    "Los clientes transferirían a una cuenta equivocada y nos enteraríamos días después por los reclamos. Por eso queda registrado quién lo cambió y cuándo.",
} as const;

/** La pantalla de la oficina, con las ocho bodegas. */
export const SINPE_OFICINA = {
  titulo: "SINPE por bodega",
  aviso:
    "Cada bodega cobra en su propio número. Lo que cambiés acá es lo que van a leer los clientes de esa bodega cuando su pedido salga a entrega.",
  columnaBodega: "Bodega",
  columnaNumero: "Número SINPE",
  columnaNombre: "A nombre de",
  /**
   * ⚠️ DICE «revisión» Y NO «cambio», Y ES UNA CORRECCIÓN DELIBERADA AL RÓTULO PROPUESTO.
   *
   * Lo que se pinta en esta columna es `zona.sinpe_revisado_at`, y esa fecha se mueve TAMBIÉN
   * cuando alguien confirma SIN cambiar nada (R25: eso no deja fila de historial precisamente
   * porque no cambió nada). Titularla «Último cambio» le diría a la oficina que ese día alguien
   * tocó el número, y a veces no será verdad — un dato falso en una pantalla de dinero, que es la
   * familia de fallo entera de esta ficha.
   *
   * El «quién lo cambió» SÍ existe, pero vive en el registro de acciones (`/historico/acciones`,
   * `maestro`-only) y no en este DTO. Traerlo aquí es backend nuevo y queda declarado, no fingido.
   */
  columnaRevision: "Última revisión",
  /** La columna del boton. Lleva rotulo de verdad: ocho `<th>` vacios no son una tabla. */
  columnaAcciones: "Acciones",
  editar: "Editar",
  chipCentral: "Central",
  /**
   * ⚠️ «Sin revisar» Y NO «error». Una bodega recién sembrada tiene un número VALIDO —el de la
   * central—; lo que pasa es que esa plata entra a la central y no a la bodega. Pintarlo en rojo
   * dejaría a la oficina con ocho alarmas el día del despliegue, y una alarma que sale ocho veces
   * el primer día se aprende a ignorar antes de que llegue la que sí importa.
   */
  chipSinRevisar: "Sin revisar",
  notaSinRevisar:
    "«Sin revisar» no es un error: esas bodegas siguen con el número de la central, que es un número válido. Lo que hay que decidir es si ese cobro tiene que entrar a la central o a la bodega.",
  tablaCaption: "SINPE de cobro de cada bodega",
  vacio: "No hay bodegas que puedas ver acá.",
} as const;

/** El aviso del primer ingreso (T22). Pide, no bloquea. */
export const SINPE_REVISION = {
  /** Se completa con el nombre de la bodega. */
  tituloPrefijo: "Confirmá el SINPE de",
  cuerpo:
    "Hasta ahora tu bodega cobraba en el número de la central. Confirmá el tuyo para que la plata de tus clientes llegue a donde tiene que llegar.",
  /**
   * ⚠️ «Ahora no» EXISTE A PROPOSITO Y NO SE QUITA. Dejar a alguien sin poder entrar a trabajar
   * por no confirmar un número sería un remedio peor que la enfermedad: el aviso reaparece al
   * siguiente ingreso, y hasta entonces el mensaje del cliente sigue llevando el número sembrado,
   * que es exactamente lo que lleva hoy.
   */
  ahoraNo: "Ahora no",
  confirmar: "Confirmar",
} as const;

/** Lo que se pinta donde no hay dato. La raya larga de las tablas de dinero. */
export const SIN_DATO = "—";

/**
 * Formateo FIJO a la zona de Costa Rica. No depende de la zona del navegador ni de la del
 * servidor que renderiza: una revisión hecha a las 23:30 de CR tiene que aparecer en el día de
 * CR y no en el siguiente. Es el mismo formateador que usa el registro de acciones.
 */
const FECHA_HORA = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/** ISO -> fecha y hora de Costa Rica. Una fecha ilegible se pinta como ausencia. */
export function fechaRevisionCR(iso: string | null): string {
  if (iso === null) return SIN_DATO;
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? SIN_DATO : FECHA_HORA.format(fecha);
}
