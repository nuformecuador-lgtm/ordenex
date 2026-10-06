// Ficha 474 (R4, R53) — vista previa de una plantilla DE INFORME, pura y sin red. La comparten la
// pantalla de Plantillas (al escribir una plantilla de informe) y la de Envíos automáticos («Vista
// previa» + «De dónde sale cada dato» de la maqueta aprobada). Las variables llegan del servidor por
// `listarInformesWhatsapp()`: este módulo NO importa el catálogo de informes (arrastra jspdf).

/** Una variable del catálogo de un informe, tal como la sirve `listarInformesWhatsapp()`. */
export interface VariableDeInforme {
  clave: string;
  nombre: string;
  descripcion: string;
  ejemplo: string;
}

/** Un dato de la lista «De dónde sale cada dato». */
export interface DatoDeVariable {
  /** `{{1}}` = la primera variable DISTINTA del cuerpo: el orden en que viaja a Meta (R32). */
  posicion: number;
  clave: string;
  nombre: string;
  valor: string;
  /** `false` = la clave no está en el catálogo del informe: no se va a rellenar (R4). */
  conocida: boolean;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Sustituye cada `{{clave}}` por su ejemplo (o por `valores[clave]` si se da) y devuelve, en el
 * orden de aparición, de dónde sale cada dato. Una clave desconocida se deja tal cual en el texto,
 * para que se vea que no se va a rellenar.
 */
export function componerVistaPrevia(
  cuerpo: string,
  variables: readonly Pick<VariableDeInforme, "clave" | "nombre" | "ejemplo">[],
  valores: Readonly<Record<string, string>> = {},
): { texto: string; datos: DatoDeVariable[] } {
  const porClave = new Map(variables.map((v) => [v.clave, v]));
  const datos: DatoDeVariable[] = [];
  const vistas = new Map<string, DatoDeVariable>();
  const texto = cuerpo.replace(PLACEHOLDER, (completo, bruta: string) => {
    const clave = bruta.trim().toLowerCase();
    let dato = vistas.get(clave);
    if (!dato) {
      const v = porClave.get(clave);
      dato = {
        posicion: datos.length + 1,
        clave,
        nombre: v?.nombre ?? clave,
        valor: valores[clave] ?? v?.ejemplo ?? "",
        conocida: v !== undefined,
      };
      vistas.set(clave, dato);
      datos.push(dato);
    }
    return dato.conocida ? dato.valor : completo;
  });
  return { texto, datos };
}
