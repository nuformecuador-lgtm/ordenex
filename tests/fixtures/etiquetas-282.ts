import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

// Feature 282 (T23/T26) — CORPUS DE REFERENCIA de la etiqueta de guia.
//
// Existe porque hasta ahora el recorte con elipsis era SILENCIOSO: la etiqueta
// salia con `...` y nadie se enteraba. Aqui se declaran los casos que NO pueden
// recortarse; si alguno lo hace, la verificacion se pone roja (R26).
//
// Honestidad sobre el corpus, que importa al leerlo: solo el primero es un caso
// REAL (sale de una etiqueta de produccion descargada el 2026-08-25). Los demas
// son FORMAS —estructuras plausibles— salvo el alfabeto del ultimo, que si esta
// medido contra produccion.

/** Base sobre la que se construyen los casos; los campos sin interes se rellenan. */
function base(overrides: Partial<EtiquetaGuiaDTO>): EtiquetaGuiaDTO {
  const numGuia = overrides.numGuia ?? 19887906;
  return {
    ordenId: `ord-${numGuia}`,
    numGuia,
    numRemision: "REM-2201",
    destinatario: "Cliente Uno",
    telefonoDest: "88887777",
    direccion: "Calle 1, casa 2",
    producto: "Caja",
    montoCobrar: 18000,
    tiendaNombre: "Tienda Uno",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Mora",
    distritoNombre: "Colón",
    qrValue: String(numGuia),
    barcodeValue: String(numGuia),
    ...overrides,
  };
}

export interface CasoEtiqueta {
  id: string;
  /** `true` solo si el caso proviene de datos reales de produccion. */
  real: boolean;
  descripcion: string;
  dto: EtiquetaGuiaDTO;
}

/**
 * EL caso de referencia: la etiqueta de produccion que evidencio los dos
 * defectos. De ella constan el numero de guia, la direccion de dos lineas, el
 * `MONTO A COBRAR` de `₡18.000` y la ubicacion de cuatro niveles. Destinatario,
 * telefono, producto, tienda y remision NO constan (PII / recortados en la
 * captura): se rellenan con valores cualesquiera y ningun requisito afirma nada
 * sobre ellos.
 */
export const CASO_EVIDENCIA: CasoEtiqueta = {
  id: "evidencia",
  real: true,
  descripcion:
    "Etiqueta real de produccion (2026-08-25): guia 19887906, direccion de dos lineas, ₡18.000, GAM / San José / Mora / Colón",
  dto: base({
    numGuia: 19887906,
    destinatario: "Destinatario Uno",
    direccion:
      "Del super La Central 200 metros al sur, casa color verde con porton negro",
    producto: "Paquete pequeño",
    montoCobrar: 18000,
  }),
};

/**
 * El peor caso que el propio codigo declaraba justo: una direccion de TRES
 * lineas. Con el cupo de 10 lineas entra con una de holgura (R6).
 */
export const CASO_DIRECCION_3_LINEAS: CasoEtiqueta = {
  id: "direccion-3-lineas",
  real: false,
  descripcion: "Forma: direccion que ocupa tres lineas completas",
  dto: base({
    numGuia: 19887907,
    direccion:
      "Avenida Segunda entre calles 9 y 11, edificio Torre Mercedes, tercer piso oficina 302, contiguo a la farmacia",
  }),
};

/** Forma: los cuatro niveles de ubicacion con nombres largos, destinatario y producto largos. */
export const CASO_UBICACION_COMPLETA: CasoEtiqueta = {
  id: "ubicacion-completa",
  real: false,
  descripcion: "Forma: cuatro niveles de ubicacion + destinatario y producto largos",
  dto: base({
    numGuia: 19887908,
    destinatario: "Rodriguez Villalobos Fernanda",
    producto: "Juego de sartenes de cinco piezas",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Montes de Oca",
    distritoNombre: "San Pedro",
    direccion: "Barrio Escalante, 100 sur del parque",
  }),
};

/**
 * EL ALFABETO REAL, medido en solo-lectura contra produccion el **2026-08-25**
 * sobre todas las ordenes vivas y sobre los campos que la etiqueta imprime:
 * 75 caracteres distintos, **6 fuera de ASCII** (`á é í ñ ó ú`) y **cero** fuera
 * de Latin-1.
 *
 * ⚠️ Es la foto de un dia y CADUCA. Un `ü`, una `Á`, un guion largo o unas
 * comillas tipograficas que entren mañana por la carga masiva no estan en esta
 * medida. Por eso el subconjunto embebido es cp1252 COMPLETO y por eso R28 no se
 * relaja: la medida justifica el TAMAÑO del subconjunto, no sustituye a fallar
 * de forma visible en tiempo de ejecucion.
 */
export const NO_ASCII_MEDIDOS = ["á", "é", "í", "ñ", "ó", "ú"] as const;

export const CASO_ALFABETO_REAL: CasoEtiqueta = {
  id: "alfabeto-real",
  real: true,
  descripcion:
    "Alfabeto medido en produccion el 2026-08-25: los seis no-ASCII (á é í ñ ó ú) repartidos por destinatario, direccion y producto",
  dto: base({
    numGuia: 19887909,
    destinatario: "José Andrés Peña",
    direccion: "Avenida Cañás, contiguo a la panadería Rincón",
    producto: "Vitrína de cerámica única",
    tiendaNombre: "Tienda Ríos",
  }),
};

/** Todos los casos que la verificacion recorre. */
export const CORPUS_282: readonly CasoEtiqueta[] = [
  CASO_EVIDENCIA,
  CASO_DIRECCION_3_LINEAS,
  CASO_UBICACION_COMPLETA,
  CASO_ALFABETO_REAL,
];
