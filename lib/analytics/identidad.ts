// Feature 122 (T3.5/T3.6) — POLITICA DE IDENTIDAD DEL MENSAJERO (D5, R38/R39).
//
// D5 autorizo al `adminTienda` a desagregar por mensajero, PERO ANONIMIZADO: ve la
// DISTRIBUCION de su propia carga entre N repartidores sin poder identificar a la
// persona. La razon que dio el humano es literal: "un adminTienda no es empleador de
// esos mensajeros". Para los demas roles la politica es `real`.
//
// La seudonimizacion NO sustituye al recorte de filas: el `adminTienda` solo alcanza sus
// propias ordenes (R26) y ENCIMA no ve quien las llevo. Son dos capas independientes y
// sus tests van por separado; si alguien quita el recorte pensando "total, va
// anonimizado", el fallo es de tenant, no de privacidad.
//
// DONDE se aplica: en el SERVIDOR, en la proyeccion del resultado, ANTES de serializar
// (lo hace la 126 en el payload y la 134 en el CSV). No es estilo: en el App Router lo
// que un Server Component "no pinta" igualmente VIAJA — el payload RSC y la respuesta de
// una Server Action son inspeccionables en la pestana Network. Un `mensajeroId` real que
// llegue al navegador ya esta filtrado aunque ningun pixel lo muestre. Por eso R39 se
// prueba sobre la CADENA SERIALIZADA COMPLETA y no sobre los campos que la UI usa.

import { MENSAJERO_SIN_ASIGNAR } from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";

export type PoliticaIdentidad = "real" | "seudonima";

/** Prefijo de la etiqueta ordinal. Se escribe UNA vez: la 130/133 lo leen de aqui. */
export const ETIQUETA_MENSAJERO = "Mensajero";

/**
 * Deriva la politica del rol. Pura, total y sin rama permisiva por defecto: el `switch`
 * es exhaustivo sobre los cinco roles de analitica y un sexto rol no compilaria.
 *
 * - `adminTienda` => `seudonima` (D5).
 * - `maestro` / `admin` => `real`: tienen acceso total a la operacion.
 * - `mensajero` => `real`: el unico mensajero que alcanza es EL MISMO (R28).
 * - `adminSatelite` => `real`. Esto es una DERIVACION, no una decision preguntada: la
 *   razon de D5 ("no es su empleador") no aplica a quien SI opera a los mensajeros de su
 *   zona. Queda senalada en `requirements.md > Preguntas abiertas` para confirmacion.
 */
export function politicaIdentidadMensajero(rol: RolAnalitica): PoliticaIdentidad {
  switch (rol) {
    case "adminTienda":
      return "seudonima";
    case "maestro":
    case "admin":
    case "adminSatelite":
    case "mensajero":
      return "real";
  }
}

/** Fila de salida: el id real desaparece del tipo, no solo del valor. */
export type FilaConMensajero<T> = Omit<T, "mensajeroId"> & { readonly mensajero: string };

/**
 * Sustituye los ids reales por etiquetas ordinales ESTABLES DENTRO DE LA RESPUESTA.
 *
 * El ordinal se asigna por ORDEN DE PRIMERA APARICION en las filas ya ordenadas por el
 * criterio de la metrica. Es determinista para una misma entrada (R32) y no necesita
 * semilla ni reloj.
 *
 * NO se deriva del uuid —ni hash, ni prefijo, ni truncado— a proposito: un identificador
 * derivado seria estable ENTRE consultas y permitiria correlacionar y, con suficientes
 * consultas, desanonimizar por interseccion. La estabilidad se promete dentro de la
 * respuesta y solo ahi; el precio asumido es que las etiquetas pueden bailar entre dos
 * consultas distintas, y eso la UI no debe prometerlo (aviso a la 130/133).
 *
 * El mapa inverso seudonimo -> id real NO se devuelve, no se guarda y no hay forma de
 * pedirlo: vive en una variable local que muere con la llamada (R39).
 *
 * El cubo `MENSAJERO_SIN_ASIGNAR` (`lib/analytics/types.ts`) se conserva tal cual: no es
 * una persona, es "ordenes sin mensajero asignado". Etiquetarlo como "Mensajero N"
 * inventaria un repartidor que no existe; conservarlo no revela a nadie.
 */
export function seudonimizarMensajeros<T extends { mensajeroId: string }>(
  filas: readonly T[],
  politica: PoliticaIdentidad,
): readonly FilaConMensajero<T>[] {
  const etiquetas = new Map<string, string>();

  return filas.map((fila) => {
    const { mensajeroId, ...resto } = fila;
    return {
      ...(resto as Omit<T, "mensajeroId">),
      mensajero: etiquetaDe(mensajeroId, politica, etiquetas),
    };
  });
}

function etiquetaDe(
  mensajeroId: string,
  politica: PoliticaIdentidad,
  etiquetas: Map<string, string>,
): string {
  if (politica === "real") return mensajeroId;
  if (mensajeroId === MENSAJERO_SIN_ASIGNAR) return MENSAJERO_SIN_ASIGNAR;

  const yaAsignada = etiquetas.get(mensajeroId);
  if (yaAsignada !== undefined) return yaAsignada;

  const nueva = `${ETIQUETA_MENSAJERO} ${etiquetas.size + 1}`;
  etiquetas.set(mensajeroId, nueva);
  return nueva;
}
