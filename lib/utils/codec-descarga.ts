// Ficha 470 (design §3.2, R8) — codec del conjunto de una descarga cuando viaja por un objeto temporal
// en Storage en vez de en la respuesta de la Server Action. PURO y sin efectos: lo usan el servidor
// (`EntregaDescargaService`, para serializar) y el navegador (`descargarDatos`, para deserializar).
//
// Una Server Action transporta `Date` y `bigint`; JSON no. El *replacer* los etiqueta y el *reviver*
// los reconstruye, de modo que el resultado deserializado es el MISMO que habria llegado en la
// respuesta. Cualquier otro tipo que JSON perderia (`Map`, `Set`, funcion, simbolo...) LANZA con el
// nombre del tipo: un fallo ruidoso, nunca un dato perdido en silencio.
//
// Limite conocido y aceptado: una propiedad con valor `undefined` llega como AUSENTE (igual de falsa
// en `?.`/`??`; distinta solo para `"k" in obj`). Lo que importa —el archivo final— se compara en
// `tests/unit/descarga/archivo-identico-470.test.ts`.

const ETIQUETA_FECHA = "__descarga_fecha__";
const ETIQUETA_BIGINT = "__descarga_bigint__";

/** Error de un valor que el codec no sabe transportar sin perderlo. */
export class ValorNoSerializableError extends Error {
  constructor(readonly tipo: string) {
    super(`codec de descarga: valor no serializable de tipo «${tipo}»`);
    this.name = "ValorNoSerializableError";
  }
}

function nombreDeTipo(valor: unknown): string {
  if (typeof valor === "function") return "function";
  if (typeof valor === "symbol") return "symbol";
  if (typeof valor === "object" && valor !== null) return (valor as object).constructor?.name ?? "Object";
  return typeof valor;
}

/** Objetos que JSON trata bien: literales y arrays (y los de prototipo nulo). */
function esPlano(valor: object): boolean {
  if (Array.isArray(valor)) return true;
  const proto = Object.getPrototypeOf(valor);
  return proto === Object.prototype || proto === null;
}

/**
 * Serializa el resultado de una accion de descarga a texto JSON, con `Date` y `bigint` etiquetados.
 * Lanza `ValorNoSerializableError` ante cualquier otro tipo no plano.
 */
export function serializarDescarga(valor: unknown): string {
  // `JSON.stringify` llama a `toJSON` de Date ANTES del replacer, asi que la fecha se mira en el
  // padre (`this[clave]`), donde aun es un `Date`.
  const texto = JSON.stringify(valor, function (this: Record<string, unknown>, clave: string, v: unknown) {
    const original = this[clave];
    if (original instanceof Date) {
      if (Number.isNaN(original.getTime())) throw new ValorNoSerializableError("Invalid Date");
      return { [ETIQUETA_FECHA]: original.toISOString() };
    }
    if (typeof v === "bigint") return { [ETIQUETA_BIGINT]: v.toString() };
    if (typeof v === "function" || typeof v === "symbol") throw new ValorNoSerializableError(nombreDeTipo(v));
    if (typeof v === "object" && v !== null && !esPlano(v)) throw new ValorNoSerializableError(nombreDeTipo(v));
    return v;
  });
  // `JSON.stringify(undefined)` devuelve `undefined`: no hay conjunto que transportar.
  if (texto === undefined) throw new ValorNoSerializableError(nombreDeTipo(valor));
  return texto;
}

/** Inverso de `serializarDescarga`: reconstruye `Date` y `bigint`. */
export function deserializarDescarga<T>(texto: string): T {
  return JSON.parse(texto, (_clave, v: unknown) => {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const claves = Object.keys(v);
      if (claves.length === 1) {
        const o = v as Record<string, unknown>;
        if (claves[0] === ETIQUETA_FECHA && typeof o[ETIQUETA_FECHA] === "string") return new Date(o[ETIQUETA_FECHA]);
        if (claves[0] === ETIQUETA_BIGINT && typeof o[ETIQUETA_BIGINT] === "string") return BigInt(o[ETIQUETA_BIGINT]);
      }
    }
    return v;
  }) as T;
}
