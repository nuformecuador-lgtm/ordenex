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
    // Feature 295: la fecha de creacion NO consta en la evidencia (la etiqueta de
    // produccion no llevaba ninguna: ese era el defecto). Se rellena con un dia
    // cualquiera y ningun requisito de la 282 afirma nada sobre ella.
    fechaCreacion: "2026-08-25",
    qrValue: String(numGuia),
    barcodeValue: String(numGuia),
    ...overrides,
  };
}

/**
 * Feature 350 (T4) — El valor que la etiqueta DEBE imprimir para cada dato,
 * escrito COMO LITERAL A MANO.
 *
 * Esto es lo que hace que la verificacion de reconstruccion (V1) valga algo. El
 * error clasico seria obtener el esperado llamando a la funcion que genera el
 * texto —`geografiaLegible(dto)` para la ubicacion, `formatMonto(...)` para el
 * importe—: eso esta SIEMPRE verde y no afirma nada, porque compara la funcion
 * consigo misma. Aqui la ubicacion se escribe «GAM / San José / Mora / Colón» a
 * mano, con sus barras y sus espacios, y el importe con su simbolo.
 */
export interface EsperadoEtiqueta {
  numGuia: string;
  fechaCreacion: string;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  /** Lo que se imprime: el texto de la direccion, o el marcador si es null. */
  direccion: string;
  /** Los niveles de geografia unidos, escritos a mano. NUNCA `geografiaLegible`. */
  ubicacion: string;
  /** El importe formateado, escrito a mano con su simbolo. NUNCA `formatMonto`. */
  montoCobrar: string;
  producto: string;
  tiendaNombre: string;
}

export interface CasoEtiqueta {
  id: string;
  /** `true` solo si el caso proviene de datos reales de produccion. */
  real: boolean;
  descripcion: string;
  dto: EtiquetaGuiaDTO;
  /** Feature 350: los diez datos que el papel tiene que traer, literales. */
  esperado: EsperadoEtiqueta;
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
  esperado: {
    numGuia: "19887906",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "Destinatario Uno",
    telefonoDest: "88887777",
    direccion:
      "Del super La Central 200 metros al sur, casa color verde con porton negro",
    ubicacion: "GAM / San José / Mora / Colón",
    montoCobrar: "₡18.000",
    producto: "Paquete pequeño",
    tiendaNombre: "Tienda Uno",
  },
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
  esperado: {
    numGuia: "19887907",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "Cliente Uno",
    telefonoDest: "88887777",
    direccion:
      "Avenida Segunda entre calles 9 y 11, edificio Torre Mercedes, tercer piso oficina 302, contiguo a la farmacia",
    ubicacion: "GAM / San José / Mora / Colón",
    montoCobrar: "₡18.000",
    producto: "Caja",
    tiendaNombre: "Tienda Uno",
  },
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
  esperado: {
    numGuia: "19887908",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "Rodriguez Villalobos Fernanda",
    telefonoDest: "88887777",
    direccion: "Barrio Escalante, 100 sur del parque",
    ubicacion: "GAM / San José / Montes de Oca / San Pedro",
    montoCobrar: "₡18.000",
    producto: "Juego de sartenes de cinco piezas",
    tiendaNombre: "Tienda Uno",
  },
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
  esperado: {
    numGuia: "19887909",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "José Andrés Peña",
    telefonoDest: "88887777",
    direccion: "Avenida Cañás, contiguo a la panadería Rincón",
    ubicacion: "GAM / San José / Mora / Colón",
    montoCobrar: "₡18.000",
    producto: "Vitrína de cerámica única",
    tiendaNombre: "Tienda Ríos",
  },
};

// ===========================================================================
// Feature 350 (T4) — Los tres casos que el rediseño añade.
// ===========================================================================

/**
 * EL PEOR CASO MEDIDO: una direccion de **286** caracteres y un producto de
 * **138**, que son las longitudes MAXIMAS medidas en produccion sobre 887
 * etiquetas (la media de la direccion es 65 y el p95, 119).
 *
 * ⚠️ Honestidad sobre este caso, y es la misma disciplina con la que el archivo
 * declara sus «formas»: lo REAL aqui son **las longitudes**, no el texto. Las
 * cadenas de produccion son PII y no constan; estas son sinteticas y plausibles.
 * Por eso existe ademas `CASO_PALABRA_SIN_ESPACIOS`: la longitud no determina el
 * ancho —la FORMA si—, y un texto sintetico «bien repartido» podria caber donde
 * uno real no cabria.
 */
export const CASO_PEOR_MEDIDO: CasoEtiqueta = {
  id: "peor-caso-medido",
  real: false,
  descripcion:
    "Longitudes REALES del maximo de produccion (direccion 286, producto 138); el texto es sintetico",
  dto: base({
    numGuia: 19887910,
    destinatario: "José Andrés Peña Rodríguez Villalobos",
    telefonoDest: "8888 7777",
    direccion:
      "Del supermercado La Central de Barrio Escalante, doscientos metros al sur y ciento cincuenta al oeste, casa esquinera de dos plantas color verde agua con portón negro y tapia baja, frente al parqueo del taller de motos, entrada por el callejón sin salida contiguo a la panadería Ríos 24",
    producto:
      "Juego de sartenes antiadherentes de cinco piezas con tapa de vidrio templado, mango desmontable y estuche de cartón reforzado azul marino.",
    tiendaNombre: "Comercializadora de Electrodomésticos del Valle",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Montes de Oca",
    distritoNombre: "San Pedro",
    montoCobrar: 18000,
  }),
  esperado: {
    numGuia: "19887910",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "José Andrés Peña Rodríguez Villalobos",
    telefonoDest: "8888 7777",
    direccion:
      "Del supermercado La Central de Barrio Escalante, doscientos metros al sur y ciento cincuenta al oeste, casa esquinera de dos plantas color verde agua con portón negro y tapia baja, frente al parqueo del taller de motos, entrada por el callejón sin salida contiguo a la panadería Ríos 24",
    ubicacion: "GAM / San José / Montes de Oca / San Pedro",
    montoCobrar: "₡18.000",
    producto:
      "Juego de sartenes antiadherentes de cinco piezas con tapa de vidrio templado, mango desmontable y estuche de cartón reforzado azul marino.",
    tiendaNombre: "Comercializadora de Electrodomésticos del Valle",
  },
};

/** Longitudes del peor caso, afirmadas por el propio corpus (no se confia en el ojo). */
export const PEOR_CASO_LARGOS = { direccion: 286, producto: 138 } as const;

/**
 * FORMA ADVERSARIAL de R3: una «palabra» de 60 caracteres sin un solo espacio
 * dentro de la direccion. Existe porque la longitud NO determina el ancho de
 * linea: un envolvedor por palabras no tiene donde partir y, si no parte por
 * caracter, la deja desbordar el bloque. Es el unico caso del corpus que ejerce
 * el partido por caracter.
 */
export const PALABRA_SIN_ESPACIOS =
  "ResidencialLosAltosDeSanRafaelDeEscazuTorreNorteApto12BisNvo";

export const CASO_PALABRA_SIN_ESPACIOS: CasoEtiqueta = {
  id: "palabra-sin-espacios",
  real: false,
  descripcion:
    "Forma adversarial: una palabra de 60 caracteres sin espacios dentro de la direccion (R3)",
  dto: base({
    numGuia: 19887911,
    direccion: `Barrio ${PALABRA_SIN_ESPACIOS} casa 4`,
  }),
  esperado: {
    numGuia: "19887911",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "Cliente Uno",
    telefonoDest: "88887777",
    direccion:
      "Barrio ResidencialLosAltosDeSanRafaelDeEscazuTorreNorteApto12BisNvo casa 4",
    ubicacion: "GAM / San José / Mora / Colón",
    montoCobrar: "₡18.000",
    producto: "Caja",
    tiendaNombre: "Tienda Uno",
  },
};

/**
 * CONTROL POSITIVO del ajuste: todos los campos en su forma mas corta. Sirve
 * para afirmar que el motor **sube** el cuerpo cuando sobra sitio en vez de
 * dejarlo en el suelo — sin este caso, un ajuste que dibujara SIEMPRE a 7 pt
 * pasaria todos los demas tests en verde.
 *
 * `direccion` es `null` a proposito: es la forma mas corta posible y ademas
 * ejercita el marcador de dato ausente.
 */
export const CASO_MINIMOS: CasoEtiqueta = {
  id: "minimos",
  real: false,
  descripcion: "Control positivo: todos los campos en su forma mas corta",
  dto: base({
    numGuia: 19887912,
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "88",
    direccion: null,
    producto: "Caja",
    tiendaNombre: "Uno",
    zonaNombre: "GAM",
    // `provinciaNombre` y `cantonNombre` NO son nullable en el DTO (solo el
    // distrito lo es, R4 de la 32): la forma mas corta es la mas breve posible,
    // no la ausencia.
    provinciaNombre: "SJ",
    cantonNombre: "Mora",
    distritoNombre: null,
    montoCobrar: 500,
  }),
  esperado: {
    numGuia: "19887912",
    fechaCreacion: "2026-08-25",
    numRemision: "R-1",
    destinatario: "Ana",
    telefonoDest: "88",
    // El marcador de «sin direccion», escrito a mano: es una raya larga (U+2014).
    direccion: "—",
    ubicacion: "GAM / SJ / Mora",
    montoCobrar: "₡500",
    producto: "Caja",
    tiendaNombre: "Uno",
  },
};

/**
 * LA FORMA ADVERSARIAL DE VERDAD, y por que hacen falta las dos.
 *
 * `PALABRA_SIN_ESPACIOS` mide 60 caracteres —el numero que pedia el spec— pero
 * MEDIDO con la fuente real ocupa **74,9 mm a 7 pt**, o sea que CABE en los
 * 88 mm del ancho util. Consecuencia: el ajuste se limita a bajar el cuerpo
 * hasta que entra y el partido por caracter no llega a ejercerse. Se comprobo
 * con la mutacion M3 (quitar el partido de palabras): el caso de 60 caracteres
 * sobrevive en verde.
 *
 * Este caso lleva una palabra que NO CABE en una linea ni con el cuerpo minimo
 * (110 caracteres, 133,5 mm a 7 pt frente a 88 mm de ancho util), asi que la unica
 * salida honesta es partirla y continuarla (R3). Es el caso que mata M3.
 */
export const PALABRA_IMPOSIBLE =
  "ResidencialLosAltosDeSanRafaelDeEscazuTorreNorteApartamentoDoceBisNuevoEdificioPortonAzulEntradaPrincipalNorte";

export const CASO_PALABRA_IMPOSIBLE: CasoEtiqueta = {
  id: "palabra-imposible",
  real: false,
  descripcion:
    "Forma adversarial MEDIDA: una palabra que no cabe en una linea ni con el cuerpo minimo (R3)",
  dto: base({
    numGuia: 19887913,
    direccion: `Barrio ${PALABRA_IMPOSIBLE} casa 4`,
  }),
  esperado: {
    numGuia: "19887913",
    fechaCreacion: "2026-08-25",
    numRemision: "REM-2201",
    destinatario: "Cliente Uno",
    telefonoDest: "88887777",
    direccion:
      "Barrio ResidencialLosAltosDeSanRafaelDeEscazuTorreNorteApartamentoDoceBisNuevoEdificioPortonAzulEntradaPrincipalNorte casa 4",
    ubicacion: "GAM / San José / Mora / Colón",
    montoCobrar: "₡18.000",
    producto: "Caja",
    tiendaNombre: "Tienda Uno",
  },
};

/** Todos los casos que la verificacion recorre. */
export const CORPUS_282: readonly CasoEtiqueta[] = [
  CASO_EVIDENCIA,
  CASO_DIRECCION_3_LINEAS,
  CASO_UBICACION_COMPLETA,
  CASO_ALFABETO_REAL,
  CASO_PEOR_MEDIDO,
  CASO_PALABRA_SIN_ESPACIOS,
  CASO_PALABRA_IMPOSIBLE,
  CASO_MINIMOS,
];
