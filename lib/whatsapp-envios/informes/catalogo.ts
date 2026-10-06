// Ficha 474 (design §2/§3, R3/R4/R46/R53) — REGISTRO UNICO de informes y catalogo de variables.
//
// `CAMPOS_PLANTILLA` (el catalogo de la 107, datos de UNA orden) NO se toca: una plantilla de orden
// sigue leyendo de alli. Una plantilla de informe lee `informe.variables` + las COMUNES. Quien
// necesite saber «que variables tiene esta plantilla» (vista previa, picker, claves desconocidas,
// ejemplos que viajan a Meta) llama a `catalogoDeVariables(informeClave)`.
import type { InformeWhatsapp, VariableInforme } from "@/lib/whatsapp-envios/informes/tipos";
import { informePruebaEnvio } from "@/lib/whatsapp-envios/informes/prueba-envio";
import { crearInformeAvisoInterno } from "@/lib/whatsapp-envios/informes/aviso-interno";
import { CAMPOS_PLANTILLA_OFRECIDOS } from "@/lib/types/plantilla-datos";

/**
 * R53 — variables COMUNES a toda plantilla de informe. `destinatario_nombre` es la UNICA por
 * ENTREGA: el motor la rellena con el nombre de cada destinatario (en «Probar ahora», el de quien
 * pulsa). Ningun informe puede declarar una variable con esta clave (R46).
 */
export const VARIABLES_COMUNES: readonly VariableInforme[] = [
  {
    clave: "destinatario_nombre",
    nombre: "Nombre del destinatario",
    descripcion: "El nombre de la persona que recibe el mensaje.",
    ejemplo: "Daniel",
  },
];

export const CLAVE_DESTINATARIO_NOMBRE = "destinatario_nombre";

/** El catalogo. Una entrada por informe; la clave del mapa es la `clave` del informe. */
export const INFORMES_WHATSAPP: ReadonlyMap<string, InformeWhatsapp<unknown>> = new Map(
  ([informePruebaEnvio, crearInformeAvisoInterno()] as InformeWhatsapp<unknown>[]).map((i) => [
    i.clave,
    i,
  ]),
);

/** El informe registrado con esa clave, o `null`. */
export function informePorClave(clave: string): InformeWhatsapp<unknown> | null {
  return INFORMES_WHATSAPP.get(clave) ?? null;
}

/** Variable tal como la consume la pantalla (picker, vista previa) y la subida a Meta. */
export interface VariableCatalogo {
  clave: string;
  nombre: string;
  descripcion: string;
  ejemplo: string;
}

/**
 * Design §3 (R4/R53) — catalogo de variables de una plantilla. `null` = plantilla de ORDEN (el de
 * siempre, `CAMPOS_PLANTILLA_OFRECIDOS`). Una clave de informe desconocida devuelve `[]`: no hay
 * variables que ofrecer, y toda clave del cuerpo saldra como desconocida.
 */
export function catalogoDeVariables(informeClave: string | null): VariableCatalogo[] {
  if (informeClave === null) {
    return CAMPOS_PLANTILLA_OFRECIDOS.map((c) => ({
      clave: c.clave,
      nombre: c.nombre,
      descripcion: c.descripcion,
      ejemplo: c.ejemplo,
    }));
  }
  const informe = informePorClave(informeClave);
  if (informe === null) return [];
  return [...informe.variables, ...VARIABLES_COMUNES].map((v) => ({ ...v }));
}

/** Ejemplo por clave para una plantilla de informe (lo que viaja a Meta, R5). */
export function ejemploDeVariableInforme(informeClave: string): (clave: string) => string {
  const porClave = new Map(catalogoDeVariables(informeClave).map((v) => [v.clave, v.ejemplo]));
  return (clave) => {
    const ej = porClave.get(clave);
    return ej !== undefined && ej !== "" ? ej : clave.toUpperCase();
  };
}

/** Resumen de un informe para la pantalla (sin la funcion `generar` ni el schema). */
export interface InformeResumen {
  clave: string;
  nombre: string;
  descripcion: string;
  generaDocumento: boolean;
  aptoParaAdminTienda: boolean;
  soloPorEvento: boolean;
  eventos: string[];
  parametrosPorDefecto: unknown;
  descriptores: InformeWhatsapp<unknown>["descriptores"];
  variables: VariableCatalogo[];
}

export function resumenDeInforme(informe: InformeWhatsapp<unknown>): InformeResumen {
  return {
    clave: informe.clave,
    nombre: informe.nombre,
    descripcion: informe.descripcion,
    generaDocumento: informe.generaDocumento,
    aptoParaAdminTienda: informe.aptoParaAdminTienda,
    soloPorEvento: informe.soloPorEvento,
    eventos: [...informe.eventos],
    parametrosPorDefecto: informe.parametrosPorDefecto,
    descriptores: informe.descriptores,
    variables: catalogoDeVariables(informe.clave),
  };
}
