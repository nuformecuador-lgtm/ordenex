import { describe, it, expect } from "vitest";

import {
  MAX_PUNTOS_SERIE,
  MAX_CATEGORIAS_LEGIBLES,
  prepararSeries,
} from "@/components/private/analytics/topes";
import type { GranularidadVista, VistaFinanciera } from "@/lib/types/analitica-financiera";
import {
  COLUMNAS_IMPORTE,
  COLUMNAS_IMPORTE_SOLO_BRUTO,
  ImporteSinNetoError,
  aNumero,
  agruparCola,
  columnasDeVista,
  esVistaConNeto,
  esVistaTemporal,
  etiquetaDeCubo,
  filasDeVista,
  serieDeVista,
  serieTemporalDeVista,
  type TextosCubo,
  type VistaConNeto,
  type VistaTemporal,
} from "@/app/(app)/analitica/_components/financiero/adaptar";
import {
  importeConNeto,
  importeSoloBruto,
  sinNeto,
} from "@/tests/fixtures/importe-analitico";

// Feature 132 (T2.1, T2.2, T2.3) — los adaptadores puros del tablero financiero.
//
// Los tres comportamientos que se verifican aqui son los tres sitios donde esta
// feature podria mentir sobre el dinero sin que nada mas lo note:
//   1. convertir un importe ilegible en `0` (R15),
//   2. pintar una cifra que no esta literalmente en el DTO (R14, R16, R24),
//   3. recortar categorias perdiendo parte del total (R20, R21).
//
// Feature 183 ⟨D12⟩ (humano, 2026-08-04) anade un CUARTO, que es de la misma familia:
//   4. rellenar la ausencia del `neto` con algo —`null`, `0`, "" o el propio bruto—
//      donde el importe no lo publica (R19, R21, R22, R23 de la 183). El ausente de la
//      132 significa «no se sabe» (R15); «no aplica» es otra cosa y no se pinta igual.

const ETIQUETA_COLA = "Resto";

/** Un id opaco de tienda, tal como lo entrega el servicio: sin nombre legible. */
const CUBO_OPACO = "clx8s7q0000tienda";

/**
 * La vista se tipa como `VistaConNeto` y no como `VistaFinanciera` a proposito: es lo
 * que permite pedirle la serie del `"neto"` sin estrechar, y a la vez lo que hace que
 * la version `solo_bruto` de mas abajo NO pueda pedirla (R2/R21 de la 183).
 */
function vistaDeEjemplo(): VistaConNeto {
  return {
    id: "cod_recaudado__por_tienda",
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    // Feature 180 / R4 — `granularidad` REQUERIDA. El cubo es la tienda: `no_temporal`.
    // El adaptador NO la lee (Q4 = (a): la 180 es solo backend); esta porque el tipo la exige.
    granularidad: "no_temporal",
    filas: [
      { cubo: CUBO_OPACO, importe: importeConNeto("1234567.89", "1200000.00") },
      { cubo: "clx8s7q0001tienda", importe: importeConNeto("500.25", "-123.45") },
      { cubo: "clx8s7q0002tienda", importe: importeConNeto("0.00", "0.00") },
    ],
    total: importeConNeto("1235068.14", "1199876.55"),
  };
}

/**
 * LA MISMA vista, con la distincion retirada: mismo id, mismo grano, mismos brutos.
 *
 * Que las dos se construyan de la de arriba es el punto: lo unico que cambia entre
 * ellas es la FORMA del DTO, asi que cualquier diferencia de comportamiento del
 * adaptador solo puede venir de la forma y nunca del id de la metrica (R22).
 */
function vistaDeEjemploSoloBruto(): VistaFinanciera {
  const conNeto = vistaDeEjemplo();
  return {
    ...conNeto,
    filas: conNeto.filas.map((fila) => ({ ...fila, importe: sinNeto(fila.importe) })),
    total: sinNeto(conNeto.total),
  };
}

function vistaConCubos(cantidad: number): VistaConNeto {
  return {
    id: "cod_recaudado__por_tienda",
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    // R4 — el cubo es la tienda: `no_temporal`.
    granularidad: "no_temporal",
    filas: Array.from({ length: cantidad }, (_, indice) => ({
      cubo: `${CUBO_OPACO}${indice}`,
      importe: importeConNeto(`${(indice + 1) * 100}.00`, `${(indice + 1) * 90}.00`),
    })),
    total: importeConNeto("0.00", "0.00"),
  };
}

function sumaDe(puntos: readonly { valor: number | null }[]): number {
  return puntos.reduce((total, punto) => total + (punto.valor ?? 0), 0);
}

/* -------------------------------------------------------------------------- */
/* Feature 186 — fixtures de la dimension TEMPORAL                             */
/* -------------------------------------------------------------------------- */

/**
 * Los textos de rotulacion, escritos AQUI porque el modulo puro no los escribe: los pone
 * el llamador, igual que `etiquetaOtros` en `agruparCola`. No son los del tablero a
 * proposito —son marcadores inconfundibles—, para que estos casos midan la FUNCION y no
 * las cadenas concretas que la region acabe eligiendo.
 */
const TEXTOS_CUBO: TextosCubo = {
  dia: "DIARIO",
  semana: "SEMANAL",
  granoNoDeclarado: "GRANO-SIN-DECLARAR",
};

/** Una clave de cubo tal como la publica el DTO: la fecha del PRIMER dia incluido. */
const CLAVE_CUBO = "2026-07-20";

/** Cuenta cuantas fechas `YYYY-MM-DD` distintas nombra un texto. */
function fechasEn(texto: string): string[] {
  return texto.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

/**
 * Una vista TEMPORAL con `n` cubos consecutivos, tipada como `VistaTemporal & VistaConNeto`
 * para poder pedirle las dos series.
 *
 * Las claves se derivan de `CLAVE_CUBO` en UTC, que es como `trocear` produce las suyas.
 * Los importes son ajenos entre si (13 y 17 centimos) para que ningun punto pueda acertar
 * por azar el valor de otro.
 */
function vistaTemporalDeEjemplo(
  granularidad: VistaTemporal["granularidad"],
  cubos = 3,
): VistaTemporal & VistaConNeto {
  const MS_POR_DIA = 86_400_000;
  const origen = Date.parse(`${CLAVE_CUBO}T00:00:00Z`);
  return {
    id: "dinero_en_caja__vista",
    grano: "fecha",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    granularidad,
    filas: Array.from({ length: cubos }, (_, indice) => ({
      cubo: new Date(origen + indice * MS_POR_DIA).toISOString().slice(0, 10),
      importe: importeConNeto(`${(indice + 1) * 7}.13`, `-${(indice + 1) * 3}.17`),
    })),
    total: importeConNeto("999.99", "-888.88"),
  };
}

/* -------------------------------------------------------------------------- */
/* R5/186 · la señal de serie temporal se lee POR LA NEGATIVA                  */
/* -------------------------------------------------------------------------- */

describe("R5/186 · `esVistaTemporal` niega el valor no temporal en vez de enumerar los granos", () => {
  it("las dos granularidades temporales de hoy son serie, y la no temporal no lo es", () => {
    expect(esVistaTemporal(vistaTemporalDeEjemplo("dia"))).toBe(true);
    expect(esVistaTemporal(vistaTemporalDeEjemplo("semana"))).toBe(true);
    expect(esVistaTemporal(vistaDeEjemplo())).toBe(false);
  });

  it("una granularidad que este binario no conoce se trata como SERIE, no como desglose", () => {
    // El `as` construye un valor fuera del dominio de HOY a proposito: el caso no habla de
    // lo que el tipo permite, sino de lo que llega por JSON desde una cache o desde una
    // version del servidor desplegada antes que este cliente. Con la señal escrita en
    // positivo (`=== "dia" || === "semana"`) esta vista caeria en la rama de tabla, que es
    // exactamente el defecto que estuvo siete horas en produccion el 2026-08-06.
    const futura = {
      ...vistaTemporalDeEjemplo("dia"),
      granularidad: "quincena" as unknown as GranularidadVista,
    } as VistaFinanciera;

    expect(esVistaTemporal(futura)).toBe(true);
  });

  it("`esVistaTemporal` no mira el grano, ni el numero de filas, ni el id de la vista", () => {
    // Contrapeso de forma: la MISMA vista con la misma dimension, las mismas filas y el
    // mismo id responde distinto solo al cambiar `granularidad`. Un predicado que decidiera
    // por `grano === "fecha"` o por `filas.length > 0` daria la misma respuesta a las dos.
    const temporal = vistaTemporalDeEjemplo("dia");
    const noTemporal: VistaFinanciera = { ...temporal, granularidad: "no_temporal" };

    expect(temporal.grano).toBe(noTemporal.grano);
    expect(temporal.id).toBe(noTemporal.id);
    expect(temporal.filas).toHaveLength(noTemporal.filas.length);
    expect(esVistaTemporal(temporal)).toBe(true);
    expect(esVistaTemporal(noTemporal)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R7, R8, R9/186 · la granularidad se lee o se miente                        */
/* -------------------------------------------------------------------------- */

describe("R7/186 · la etiqueta declara el grano: la misma clave no se rotula igual en dia que en semana", () => {
  it("la etiqueta del MISMO cubo cambia entre dia y semana", () => {
    // ES EL CASO QUE DA NOMBRE A LA FICHA. Un rango largo llega en cubos SEMANALES y su
    // clave es la del primer dia incluido: rotularla como un dia miente sobre siete veces
    // mas dinero por punto, y lo hace sin que ningun otro test se ponga rojo. La mutacion
    // que este caso mata es ignorar el parametro `granularidad` al etiquetar.
    const comoDia = etiquetaDeCubo(CLAVE_CUBO, "dia", TEXTOS_CUBO);
    const comoSemana = etiquetaDeCubo(CLAVE_CUBO, "semana", TEXTOS_CUBO);

    expect(comoDia).not.toBe(comoSemana);
    expect(comoSemana).toContain(TEXTOS_CUBO.semana);
    expect(comoDia).not.toContain(TEXTOS_CUBO.semana);
  });

  it("las dos etiquetas conservan la clave del DTO LITERAL, sin traducirla ni acortarla", () => {
    // R24 de la 132: el identificador del cubo se pinta tal cual. Declarar el grano solo en
    // el titulo (alternativa 7, descartada) dejaria el eje diciendo una fecha suelta.
    for (const grano of ["dia", "semana"] as const) {
      expect(etiquetaDeCubo(CLAVE_CUBO, grano, TEXTOS_CUBO)).toContain(CLAVE_CUBO);
    }
  });

  it("la serie entera se rotula con el grano de SU vista, punto a punto", () => {
    const semanal = serieTemporalDeVista(vistaTemporalDeEjemplo("semana"), "bruto", TEXTOS_CUBO);
    const diaria = serieTemporalDeVista(vistaTemporalDeEjemplo("dia"), "bruto", TEXTOS_CUBO);

    expect(semanal.puntos.map((p) => p.categoria)).not.toEqual(
      diaria.puntos.map((p) => p.categoria),
    );
    for (const punto of semanal.puntos) {
      expect(punto.categoria).toContain(TEXTOS_CUBO.semana);
    }
  });
});

describe("R8/186 · la etiqueta nombra UNA sola fecha y el sistema no calcula ninguna", () => {
  it("la etiqueta nombra UNA sola fecha: la clave del cubo, y ninguna calculada", () => {
    // La mutacion que mata: etiquetar el cubo semanal con su rango (`clave – clave+6`). El
    // DTO no publica el fin del cubo y el primero y el ultimo estan TRUNCADOS al rango, asi
    // que un rango calculado seria falso justo en los dos extremos — que es donde se mira
    // para saber si el periodo esta completo.
    for (const grano of ["dia", "semana"] as const) {
      const etiqueta = etiquetaDeCubo(CLAVE_CUBO, grano, TEXTOS_CUBO);
      expect(fechasEn(etiqueta)).toEqual([CLAVE_CUBO]);
      expect(fechasEn(etiqueta)).toHaveLength(1);
    }
  });

  it("ninguna etiqueta de una serie semanal nombra una segunda fecha", () => {
    const serie = serieTemporalDeVista(vistaTemporalDeEjemplo("semana", 8), "bruto", TEXTOS_CUBO);
    const claves = vistaTemporalDeEjemplo("semana", 8).filas.map((fila) => fila.cubo);

    serie.puntos.forEach((punto, indice) => {
      expect(fechasEn(punto.categoria)).toEqual([claves[indice]!]);
    });
  });

  it("el rotulador es PURO: la misma entrada da la misma salida y no depende del reloj", () => {
    // Sin `Date`, sin zona horaria y sin aritmetica de calendario (⟨D4⟩). Si la funcion
    // construyera una fecha, dos llamadas en momentos distintos podrian diferir y, peor,
    // meteria una segunda definicion del dia de Costa Rica en el frontend.
    expect(etiquetaDeCubo(CLAVE_CUBO, "semana", TEXTOS_CUBO)).toBe(
      etiquetaDeCubo(CLAVE_CUBO, "semana", TEXTOS_CUBO),
    );
    // Una clave que NO es una fecha se copia igual de literal: el rotulador no la
    // interpreta ni la valida.
    expect(etiquetaDeCubo("clave-opaca", "dia", TEXTOS_CUBO)).toContain("clave-opaca");
  });
});

describe("R9/186 · una granularidad desconocida no se rotula como si fuera un dia", () => {
  it("una granularidad desconocida no se rotula como si fuera un dia", () => {
    // El `as` esta aqui por ⟨D5⟩ y se explica para que nadie lo lea como un descuido: la
    // rama `default` NO existe para un valor que el tipo permita hoy —el `switch` es
    // exhaustivo—, sino para un DTO que llegue de una cache o de una version desplegada
    // antes con un valor nuevo del enum. Un `switch` con `never` daria seguridad en
    // compilacion y NINGUNA en ejecucion, que es donde ese DTO aparece.
    const desconocida = "quincena" as unknown as VistaTemporal["granularidad"];
    const etiqueta = etiquetaDeCubo(CLAVE_CUBO, desconocida, TEXTOS_CUBO);

    expect(etiqueta).not.toBe(etiquetaDeCubo(CLAVE_CUBO, "dia", TEXTOS_CUBO));
    expect(etiqueta).not.toBe(etiquetaDeCubo(CLAVE_CUBO, "semana", TEXTOS_CUBO));
    expect(etiqueta).toContain(TEXTOS_CUBO.granoNoDeclarado);
  });

  it("y aun asi conserva la clave del cubo, que es el unico dato cierto que hay", () => {
    // La mutacion que mata este par: devolver la clave CRUDA en el `default`. Con el texto
    // diario vacio, esa clave cruda seria BYTE A BYTE la etiqueta diaria — o sea, afirmar
    // un grano que no sabemos. Por eso el primer caso compara contra la etiqueta diaria y
    // este exige que la clave siga ahi.
    const desconocida = "quincena" as unknown as VistaTemporal["granularidad"];
    const etiqueta = etiquetaDeCubo(CLAVE_CUBO, desconocida, TEXTOS_CUBO);

    expect(etiqueta).toContain(CLAVE_CUBO);
    expect(fechasEn(etiqueta)).toEqual([CLAVE_CUBO]);
  });

  it("el default se distingue de la etiqueta diaria incluso con el prefijo diario VACIO", () => {
    // El contrapeso que hace el caso independiente de la cadena que el tablero elija: si el
    // texto del dia fuera "" —el contrato lo permite: «la clave se lee sola»—, un `default`
    // que devolviera la clave cruda pasaria los otros dos casos en verde.
    const textosConDiaVacio: TextosCubo = { ...TEXTOS_CUBO, dia: "" };
    const desconocida = "quincena" as unknown as VistaTemporal["granularidad"];

    expect(etiquetaDeCubo(CLAVE_CUBO, "dia", textosConDiaVacio)).toBe(CLAVE_CUBO);
    expect(etiquetaDeCubo(CLAVE_CUBO, desconocida, textosConDiaVacio)).not.toBe(CLAVE_CUBO);
  });
});

/* -------------------------------------------------------------------------- */
/* R10, R11/186 · fidelidad de la serie temporal                              */
/* -------------------------------------------------------------------------- */

describe("R10/186 · un punto por fila, en el orden del DTO, sin cola agrupada", () => {
  it("un punto por fila, en el orden del DTO, sin cola agrupada", () => {
    // Doce cubos con `MAX_CATEGORIAS_LEGIBLES = 5`: si alguien aplicara `agruparCola` a la serie
    // temporal —«por si acaso», por simetria con el donut y las barras— quedarian CINCO
    // puntos y el ultimo se llamaria «Otros». Fundir fechas en «Otros» no significa nada en
    // un eje de tiempo y se comeria el final de la serie, que es lo que se mira.
    const vista = vistaTemporalDeEjemplo("dia", 12);
    const serie = serieTemporalDeVista(vista, "bruto", TEXTOS_CUBO);

    expect(serie.puntos).toHaveLength(12);
    expect(serie.puntos.length).toBeGreaterThan(MAX_CATEGORIAS_LEGIBLES);
    serie.puntos.forEach((punto, indice) => {
      expect(punto.categoria).toContain(vista.filas[indice]!.cubo);
    });
    expect(serie.puntos.map((punto) => punto.categoria)).not.toContain("Otros");
  });

  it("el orden es el del DTO: no se reordena por clave ni por valor", () => {
    // Se construye una vista con las claves DESORDENADAS: un adaptador que ordenara
    // devolveria otra secuencia, y en un eje de tiempo eso cambia la forma de la linea.
    const base = vistaTemporalDeEjemplo("dia", 3);
    const desordenada: VistaTemporal & VistaConNeto = {
      ...base,
      filas: [base.filas[2]!, base.filas[0]!, base.filas[1]!],
    };
    const serie = serieTemporalDeVista(desordenada, "bruto", TEXTOS_CUBO);

    expect(serie.puntos.map((punto) => fechasEn(punto.categoria)[0])).toEqual([
      base.filas[2]!.cubo,
      base.filas[0]!.cubo,
      base.filas[1]!.cubo,
    ]);
  });

  it("una serie de 62 puntos llega entera y no lanza", () => {
    // La frontera por el lado bueno: `MAX_PUNTOS_SERIE` es 62 y el servidor garantiza
    // (R19/R20 de la 180) que ningun rango admisible produce mas. El tablero NO recorta
    // aqui: recortar dos veces esconderia el dia en que esa garantia se rompa, y lo
    // correcto entonces es que `aplicarTopePuntos` lance fuera de produccion.
    const serie = serieTemporalDeVista(
      vistaTemporalDeEjemplo("dia", MAX_PUNTOS_SERIE),
      "bruto",
      TEXTOS_CUBO,
    );

    expect(serie.puntos).toHaveLength(MAX_PUNTOS_SERIE);
    expect(() => prepararSeries([serie])).not.toThrow();
    expect(prepararSeries([serie]).recortePuntos.recortado).toBe(false);
    expect(prepararSeries([serie]).series[0]?.puntos).toHaveLength(MAX_PUNTOS_SERIE);
  });

  it("las dos series de una vista con neto salen del MISMO reparto de cubos", () => {
    const vista = vistaTemporalDeEjemplo("dia", 5);
    const bruto = serieTemporalDeVista(vista, "bruto", TEXTOS_CUBO);
    const neto = serieTemporalDeVista(vista, "neto", TEXTOS_CUBO);

    expect(bruto.puntos.map((p) => p.categoria)).toEqual(neto.puntos.map((p) => p.categoria));
    expect(bruto.id).not.toBe(neto.id);
    expect(neto.puntos[0]?.valor).toBe(-3.17);
    expect(bruto.puntos[0]?.valor).toBe(7.13);
  });
});

describe("R11/186 · el valor sale del importe de esa fila y el ilegible queda ausente", () => {
  it("un importe ilegible es dato ausente y nunca cero", () => {
    // La mutacion que mata: un `?? 0` en la conversion. Un cero es indistinguible de «no
    // hubo movimiento», que es justamente la afirmacion que la 127 se nego a hacer — y en
    // una linea, ademas, dibuja un valle que nadie midio.
    // LAS DOS FORMAS DE ILEGIBLE, y hacen falta las dos: `""` sale por la guarda del vacio
    // —`Number("")` vale 0 en JavaScript— y `"no-es-un-numero"` sale por la comprobacion de
    // finitud. Medido: con solo la primera, un `?? 0` en el `Number.isFinite(...)` de
    // `aNumero` SOBREVIVIA a este caso. Un test que no ejercita la rama no la protege.
    const base = vistaTemporalDeEjemplo("dia", 4);
    const conRotos: VistaTemporal & VistaConNeto = {
      ...base,
      filas: [
        base.filas[0]!,
        { cubo: base.filas[1]!.cubo, importe: importeConNeto("no-es-un-numero", "tampoco") },
        { cubo: base.filas[2]!.cubo, importe: importeConNeto("", "") },
        base.filas[3]!,
      ],
    };
    const serie = serieTemporalDeVista(conRotos, "bruto", TEXTOS_CUBO);

    expect(serie.puntos.map((punto) => punto.valor)).toEqual([7.13, null, null, 28.13]);
    expect(serie.puntos[1]?.valor).not.toBe(0);
    expect(serie.puntos[2]?.valor).not.toBe(0);
    // Y los puntos siguen en su sitio: el ausente no se quita, se marca.
    expect(serie.puntos).toHaveLength(4);
    expect(serie.puntos[1]?.categoria).toContain(base.filas[1]!.cubo);
  });

  it("el valor es el del campo pedido de SU fila, sin derivarlo del total ni del vecino", () => {
    const vista = vistaTemporalDeEjemplo("dia", 4);
    const serie = serieTemporalDeVista(vista, "bruto", TEXTOS_CUBO);

    serie.puntos.forEach((punto, indice) => {
      expect(punto.valor).toBe(Number(vista.filas[indice]!.importe.bruto));
    });
    // El total del DTO (999.99) no aparece en ningun punto: la linea no lo reparte.
    expect(serie.puntos.map((punto) => punto.valor)).not.toContain(999.99);
  });

  it("pedirle el neto a una vista temporal `solo_bruto` FALLA con nombre, no devuelve el bruto", () => {
    // Mismo cinturon que `serieDeVista`: las sobrecargas lo impiden en compilacion, y si
    // alguien lo fuerza con un `as`, el adaptador no inventa.
    const conNeto = vistaTemporalDeEjemplo("dia", 2);
    // Se tipa como `VistaTemporal` —que es lo que de verdad es— y el `as` a la
    // interseccion es lo unico que permite ESCRIBIR la llamada prohibida. Las
    // sobrecargas la rechazan en compilacion, que es la defensa de verdad.
    const soloBruto: VistaTemporal = {
      ...conNeto,
      filas: conNeto.filas.map((fila) => ({ ...fila, importe: sinNeto(fila.importe) })),
      total: sinNeto(conNeto.total),
    };

    expect(() =>
      serieTemporalDeVista(soloBruto as VistaTemporal & VistaConNeto, "neto", TEXTOS_CUBO),
    ).toThrow(ImporteSinNetoError);
  });
});

/* -------------------------------------------------------------------------- */
/* R15 · un importe ilegible es un dato AUSENTE, nunca un cero                 */
/* -------------------------------------------------------------------------- */

describe("R15 · un importe que no se puede leer se pinta como ausente y no como cero", () => {
  it("un importe valido conserva su valor, incluido el cero explicito y el negativo", () => {
    expect(aNumero("0.00")).toBe(0);
    expect(aNumero("-123.45")).toBe(-123.45);
    expect(aNumero("1234567.89")).toBe(1234567.89);
  });

  it("una cadena vacia no vale cero: no hay dato que afirmar", () => {
    // `Number("")` vale 0 en JavaScript. Si el adaptador se apoyara en esa
    // conversion, un importe que el servicio no pudo producir apareceria en
    // pantalla como "no hubo movimiento", que es una afirmacion distinta.
    expect(aNumero("")).toBeNull();
    expect(aNumero("")).not.toBe(0);
  });

  it("una cadena de solo espacios tampoco vale cero", () => {
    expect(aNumero(" ")).toBeNull();
    expect(aNumero(" ")).not.toBe(0);
  });

  it("un texto que no es un numero se marca como ausente", () => {
    expect(aNumero("abc")).toBeNull();
    expect(aNumero("abc")).not.toBe(0);
  });

  it("el literal NaN se marca como ausente y no se cuela como numero", () => {
    const resultado = aNumero("NaN");
    expect(resultado).toBeNull();
    expect(resultado).not.toBe(0);
    expect(Number.isNaN(resultado as unknown as number)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R14, R16, R24 · cada cifra pintada viene literalmente del DTO              */
/* -------------------------------------------------------------------------- */

describe("R14, R16, R24 · la serie de una vista pinta los importes del DTO sin derivar nada", () => {
  it("cada punto lleva el valor del campo pedido de su propia fila", () => {
    const vista = vistaDeEjemplo();
    const serie = serieDeVista(vista, "bruto");

    expect(serie.puntos).toHaveLength(vista.filas.length);
    serie.puntos.forEach((punto, indice) => {
      expect(punto.valor).toBe(Number(vista.filas[indice]!.importe.bruto));
    });
  });

  it("el bruto y el neto producen series distintas e identificables", () => {
    const vista = vistaDeEjemplo();
    const bruto = serieDeVista(vista, "bruto");
    const neto = serieDeVista(vista, "neto");

    expect(bruto.id).not.toBe(neto.id);
    expect(bruto.id).toBe(`${vista.id}__bruto`);
    expect(neto.id).toBe(`${vista.id}__neto`);
    expect(bruto.etiqueta).toBe("bruto");
    expect(neto.etiqueta).toBe("neto");
    expect(neto.puntos[1]?.valor).toBe(-123.45);
    expect(bruto.puntos[1]?.valor).toBe(500.25);
  });

  it("el cubo se copia tal cual, sin traducirlo ni acortarlo", () => {
    const serie = serieDeVista(vistaDeEjemplo(), "neto");
    expect(serie.puntos[0]?.categoria).toBe(CUBO_OPACO);
  });

  it("un importe ilegible en una fila deja esa celda ausente sin tumbar las demas", () => {
    const vista: VistaFinanciera = {
      ...vistaDeEjemplo(),
      filas: [
        { cubo: CUBO_OPACO, importe: importeConNeto("10.00", "10.00") },
        { cubo: "roto", importe: importeConNeto("", "no-es-un-numero") },
        { cubo: "clx8s7q0002tienda", importe: importeConNeto("30.00", "30.00") },
      ],
    };
    const serie = serieDeVista(vista, "bruto");

    expect(serie.puntos.map((punto) => punto.valor)).toEqual([10, null, 30]);
  });
});

describe("R14, R16, R24 · las filas de la tabla llevan bruto y neto de la misma fila del DTO", () => {
  it("hay una fila por fila del DTO y las dos cifras son las del contrato", () => {
    const vista = vistaDeEjemplo();
    const filas = filasDeVista(vista);

    expect(filas).toHaveLength(vista.filas.length);
    filas.forEach((fila, indice) => {
      const origen = vista.filas[indice]!;
      expect(fila.id).toBe(origen.cubo);
      expect(fila.categoria).toBe(origen.cubo);
      expect(fila.valores.bruto).toBe(Number(origen.importe.bruto));
      expect(fila.valores.neto).toBe(Number(origen.importe.neto));
    });
  });

  it("las dos columnas de importe se declaran una sola vez y son distinguibles entre si", () => {
    const ids = COLUMNAS_IMPORTE.map((columna) => columna.id);
    expect(ids).toEqual(["bruto", "neto"]);
    expect(COLUMNAS_IMPORTE[0]?.etiqueta).not.toBe(COLUMNAS_IMPORTE[1]?.etiqueta);
    for (const columna of COLUMNAS_IMPORTE) {
      expect(columna.unidad).toBe("moneda");
    }
  });

  it("una fila con importe ilegible queda ausente en sus dos columnas y no en cero", () => {
    const vista: VistaFinanciera = {
      ...vistaDeEjemplo(),
      filas: [{ cubo: CUBO_OPACO, importe: importeConNeto("abc", "") }],
    };
    const [fila] = filasDeVista(vista);

    expect(fila?.valores.bruto).toBeNull();
    expect(fila?.valores.neto).toBeNull();
    expect(fila?.valores.bruto).not.toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 183 · una vista SIN neto: la ausencia no se rellena con nada        */
/* -------------------------------------------------------------------------- */

describe("R23/183 · el adaptador no convierte la ausencia del neto en null, 0, '' ni en el bruto", () => {
  it("la fila adaptada de una vista `solo_bruto` NO tiene la clave `neto`, de ninguna manera", () => {
    const vista = vistaDeEjemploSoloBruto();
    const filas = filasDeVista(vista);

    expect(filas).toHaveLength(vista.filas.length);
    filas.forEach((fila, indice) => {
      const origen = vista.filas[indice]!;
      // La clave no existe: `in` distingue «ausente» de «presente con valor nulo»,
      // que es justo lo que un `neto: null` haria indistinguible.
      expect(Object.keys(fila.valores)).toEqual(["bruto"]);
      expect("neto" in fila.valores).toBe(false);
      expect(fila.valores.bruto).toBe(Number(origen.importe.bruto));
    });
  });

  it("y no la tiene ni en `null`, ni en `0`, ni en cadena vacia, ni copiada del bruto", () => {
    // Las cuatro formas de la mutacion que R23 nombra, comprobadas una a una sobre el
    // MISMO objeto: si alguna se colara, `neto` valdria algo y no `undefined`.
    const [fila] = filasDeVista(vistaDeEjemploSoloBruto());
    const valores: Readonly<Record<string, number | null>> = fila?.valores ?? {};

    expect(valores.neto).toBeUndefined();
    expect(valores.neto).not.toBeNull();
    expect(valores.neto).not.toBe(0);
    expect(valores.neto as unknown).not.toBe("");
    expect(valores.neto).not.toBe(valores.bruto);
  });

  it("la vista CON neto sigue escribiendo las dos claves: la retirada no se generalizo (R20)", () => {
    // Contrapeso del caso de arriba: sin esto, un adaptador que dejara de escribir el
    // `neto` SIEMPRE pasaria los tres casos anteriores en verde.
    const [fila] = filasDeVista(vistaDeEjemplo());
    expect(Object.keys(fila?.valores ?? {})).toEqual(["bruto", "neto"]);
    expect(fila?.valores.neto).toBe(1200000);
  });
});

describe("R19/183 · donde no hay neto no hay columna, y por tanto no hay marcador de ausente", () => {
  it("una vista `solo_bruto` declara UNA columna y una `bruto_y_neto` declara DOS", () => {
    expect(columnasDeVista(vistaDeEjemploSoloBruto()).map((c) => c.id)).toEqual(["bruto"]);
    expect(columnasDeVista(vistaDeEjemplo()).map((c) => c.id)).toEqual(["bruto", "neto"]);
  });

  it("las dos vistas tienen el MISMO id: lo que decide es la forma del DTO y no la metrica (R22)", () => {
    // Las dos fixtures salen de la misma vista y solo se diferencian en `forma`. Un
    // adaptador que decidiera por una lista de ids escrita a mano daria la misma
    // respuesta para las dos.
    expect(vistaDeEjemploSoloBruto().id).toBe(vistaDeEjemplo().id);
    expect(columnasDeVista(vistaDeEjemploSoloBruto())).not.toEqual(
      columnasDeVista(vistaDeEjemplo()),
    );
  });

  it("la columna del bruto es EL MISMO objeto en los dos juegos: se declara una sola vez", () => {
    // Dos declaraciones separadas acabarian con etiquetas o unidades distintas para la
    // misma cifra, que es lo que la declaracion unica de la 132 evitaba.
    expect(COLUMNAS_IMPORTE_SOLO_BRUTO).toHaveLength(1);
    expect(COLUMNAS_IMPORTE_SOLO_BRUTO[0]).toBe(COLUMNAS_IMPORTE[0]);
  });

  it("la tabla de una vista sin neto no puede pintar el ausente: no hay celda donde pintarlo", () => {
    // Es la colision que R19 evita. `TablaResumen` pinta el marcador de dato ausente en
    // toda celda cuya clave no encuentra (`TablaResumen.tsx:73`); si la columna del neto
    // existiera, cada fila de estas mostraria ese marcador, que en la 132 significa «no
    // se sabe» (R15) y aqui la verdad es «no aplica».
    const vista = vistaDeEjemploSoloBruto();
    const columnas = columnasDeVista(vista);
    const filas = filasDeVista(vista);

    for (const fila of filas) {
      for (const columna of columnas) {
        expect(fila.valores[columna.id]).not.toBeUndefined();
      }
    }
  });
});

describe("R21/183 · una vista sin neto no puede emitir la serie del neto", () => {
  it("la serie del bruto se emite igual, con los mismos valores que la vista con neto", () => {
    const serie = serieDeVista(vistaDeEjemploSoloBruto(), "bruto");
    expect(serie.puntos.map((punto) => punto.valor)).toEqual(
      serieDeVista(vistaDeEjemplo(), "bruto").puntos.map((punto) => punto.valor),
    );
    expect(serie.etiqueta).toBe("bruto");
  });

  it("pedirle el neto FALLA con nombre en vez de devolver el ausente o el bruto", () => {
    // El `as` es lo unico que permite escribir esta llamada: las sobrecargas de
    // `serieDeVista` la rechazan en compilacion, que es la defensa de verdad. Lo que
    // este caso fija es que si alguien la fuerza (un `as`, un DTO por JSON), el
    // adaptador NO inventa: ni `null`, ni `0`, ni el bruto disfrazado de neto.
    const forzada = vistaDeEjemploSoloBruto() as VistaConNeto;
    expect(() => serieDeVista(forzada, "neto")).toThrow(ImporteSinNetoError);
    expect(() => serieDeVista(forzada, "neto")).toThrow(CUBO_OPACO);
  });

  it("`esVistaConNeto` responde por la forma del total Y de las filas, no por el id", () => {
    expect(esVistaConNeto(vistaDeEjemplo())).toBe(true);
    expect(esVistaConNeto(vistaDeEjemploSoloBruto())).toBe(false);

    // Una vista MEZCLADA (que R18 de la 183 prohibe) no cuenta como vista con neto: si
    // se mirara solo el total, esa fila entraria en la serie del neto y reventaria.
    const mezclada: VistaFinanciera = {
      ...vistaDeEjemplo(),
      filas: [
        { cubo: CUBO_OPACO, importe: importeConNeto("10.00", "10.00") },
        { cubo: "sin-neto", importe: importeSoloBruto("30.00") },
      ],
    };
    expect(mezclada.total.forma).toBe("bruto_y_neto");
    expect(esVistaConNeto(mezclada)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R20, R21 · la cola se agrupa y el total se conserva                        */
/* -------------------------------------------------------------------------- */

describe("R20, R21 · agrupar la cola respeta el techo del paquete sin perder dinero", () => {
  it("doce cubos con techo cinco quedan en cinco categorias, la ultima con la etiqueta del llamador", () => {
    const puntos = serieDeVista(vistaConCubos(12), "bruto").puntos;
    const agrupados = agruparCola(puntos, 5, ETIQUETA_COLA);

    expect(agrupados).toHaveLength(5);
    expect(agrupados[4]?.categoria).toBe(ETIQUETA_COLA);
    expect(agrupados.slice(0, 4).map((punto) => punto.categoria)).toEqual(
      puntos.slice(0, 4).map((punto) => punto.categoria),
    );
  });

  it("la suma de lo que se pinta es la suma de lo que se recibio", () => {
    const puntos = serieDeVista(vistaConCubos(12), "bruto").puntos;
    const agrupados = agruparCola(puntos, 5, ETIQUETA_COLA);

    expect(sumaDe(agrupados)).toBeCloseTo(sumaDe(puntos), 6);
  });

  it("por debajo del techo no se toca nada", () => {
    const puntos = serieDeVista(vistaConCubos(3), "bruto").puntos;
    expect(agruparCola(puntos, 5, ETIQUETA_COLA)).toEqual(puntos);
  });

  it("una cola entera sin dato produce una categoria ausente, no una que vale cero", () => {
    const puntos = [
      { categoria: "a", valor: 10 },
      { categoria: "b", valor: 20 },
      { categoria: "c", valor: null },
      { categoria: "d", valor: null },
    ];
    const agrupados = agruparCola(puntos, 3, ETIQUETA_COLA);

    expect(agrupados).toHaveLength(3);
    expect(agrupados[2]?.categoria).toBe(ETIQUETA_COLA);
    expect(agrupados[2]?.valor).toBeNull();
    expect(agrupados[2]?.valor).not.toBe(0);
  });

  it("sin puntos no se inventa una categoria de cola", () => {
    expect(agruparCola([], 5, ETIQUETA_COLA)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R20 (T2.3) · integracion con los topes REALES del paquete                  */
/* -------------------------------------------------------------------------- */

describe("R20 · con la cola agrupada el paquete acepta la serie; sin agrupar, revienta", () => {
  it("el entorno de este test no es produccion, que es donde los topes lanzan", () => {
    // La politica del paquete depende de `NODE_ENV`: fuera de produccion LANZA y
    // en produccion recorta en silencio. Si esta suite corriera como produccion,
    // los dos casos de abajo pasarian sin medir nada.
    expect(process.env.NODE_ENV).not.toBe("production");
  });

  it("doce cubos agrupados al tope del paquete pasan por prepararSeries sin lanzar", () => {
    const serie = serieDeVista(vistaConCubos(12), "bruto");
    const acotada = {
      ...serie,
      puntos: agruparCola(serie.puntos, MAX_CATEGORIAS_LEGIBLES, ETIQUETA_COLA),
    };

    const preparadas = prepararSeries([acotada]);
    expect(preparadas.series[0]?.puntos).toHaveLength(MAX_CATEGORIAS_LEGIBLES);
    expect(preparadas.recorteSeries.recortado).toBe(false);
    expect(preparadas.recortePuntos.recortado).toBe(false);
  });

  // ⚠ ESTE CASO SE DIO LA VUELTA EL 2026-08-18. Era el contrapeso del anterior: doce cubos
  // sin agrupar LANZABAN `SeriesExcedidasError`, y esa asercion probaba que el techo se
  // aplicaba de verdad en algun sitio. Ya no hay techo de color —la paleta tiene veinte
  // tokens y cicla— asi que doce cubos crudos pasan enteros.
  //
  // El contrapeso sigue haciendo falta, pero ahora prueba otra cosa: que `agruparCola` es lo
  // UNICO que reduce las porciones. Sin agrupar hay doce, con agrupar cinco; si el caso
  // anterior pasara sin que `agruparCola` hiciera nada, este lo delata.
  it("los mismos doce cubos SIN agrupar llegan enteros: quien reduce es agruparCola", () => {
    const serie = serieDeVista(vistaConCubos(12), "bruto");

    expect(serie.puntos).toHaveLength(12);
    expect(() => prepararSeries([serie])).not.toThrow();
    expect(prepararSeries([serie]).series[0]?.puntos).toHaveLength(12);
  });
});
