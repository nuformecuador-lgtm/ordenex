import {
  DATOS_PLANTILLA_EJEMPLO,
  resolverValoresPlantilla,
} from "@/lib/types/plantilla-datos";
import { extraerVariables, renderPlantilla } from "@/lib/utils/plantilla-mensaje";

/**
 * ⭑ FICHA 429 (T21) — EL MENSAJE REAL, PARTIDO EN TROZOS PARA PODER RESALTAR EL PAR.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * QUE PROBLEMA RESUELVE, Y POR QUE NO ES UN ADORNO
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * Un SINPE equivocado no produce NINGUN error: el mensaje sale, el cliente transfiere, y se sabe
 * dias despues por los reclamos. Lo unico que convierte ese fallo mudo en uno visible es poner el
 * numero y el titular DENTRO de la frase que el cliente va a leer, uno al lado del otro — porque
 * SINPE Movil le muestra al cliente el titular al teclear el numero, y ahi es donde se nota que
 * no coinciden.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ EL MISMO MOTOR QUE EL ENVIO, Y NO UNO PROPIO
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * El texto sale de `renderPlantilla(cuerpo, resolverValoresPlantilla(...))`, que es LITERALMENTE
 * el par de llamadas que hace el envio (`ChatWhatsappService`, `whatsapp-bienvenida-handler`) y
 * el boton wa.me del mensajero. Un renderizador propio para la vista previa seria una segunda
 * fuente del mismo texto: el dia que el envio cambiara de motor, esta pantalla seguiria
 * enseñando el mensaje viejo y diria que todo esta bien.
 *
 * EL RESALTADO SE HACE CON CENTINELAS Y NO CON UNA SEGUNDA REGEX de `{{clave}}`. Volver a
 * escribir aqui el patron de los marcadores seria otra fuente que puede divergir de
 * `PLACEHOLDER_RE`; en su lugar se le pasa al MISMO motor un valor imposible de teclear para las
 * dos claves y luego se parte el resultado por ese valor. Si el motor cambia de sintaxis, esto
 * sigue funcionando sin tocarse.
 *
 * ⚠️ LOS DEMAS CAMPOS VAN CON LOS EJEMPLOS DEL CATALOGO (`DATOS_PLANTILLA_EJEMPLO`), que es lo
 * que ya usa la vista previa de plantillas. Lo unico REAL de esta vista es el par que se esta
 * editando: lo demas es contexto para que la frase se lea como una frase.
 */

export type SegmentoMensaje =
  | { tipo: "texto"; texto: string }
  | { tipo: "numero"; texto: string }
  | { tipo: "nombre"; texto: string };

/**
 * El separador de los centinelas: el caracter de codigo 0 (NUL).
 *
 * ⚠️ SE CONSTRUYE CON `String.fromCharCode` Y NO SE ESCRIBE COMO LITERAL, y no es un capricho:
 * escrito como literal, cualquier herramienta que reescriba este archivo —un formateador, un
 * parche, un agente— puede dejar un BYTE NUL de verdad dentro del fuente, y entonces `git` deja
 * de tratarlo como texto y el diff se vuelve ilegible. Ya paso una vez en esta misma ficha.
 *
 * Se elige el 0 porque NO se puede teclear en un `<input>` ni puede salir del catalogo de
 * ejemplos: no hay forma de que un valor de verdad se confunda con un centinela y acabe
 * resaltado por accidente.
 */
const NUL = String.fromCharCode(0);
const MARCA_NUMERO = `${NUL}sinpe-numero${NUL}`;
const MARCA_NOMBRE = `${NUL}sinpe-nombre${NUL}`;

/**
 * Parte el mensaje YA RENDERIZADO en trozos de texto plano y trozos resaltados.
 *
 * @param cuerpo  el cuerpo REAL de la plantilla, tal como esta guardado. `null` = no se pudo
 *                leer; se devuelve una lista vacia y la pantalla lo dice en vez de inventarse un
 *                mensaje que nadie va a recibir.
 * @param numero  lo que la persona esta tecleando AHORA, sin validar ni normalizar: la vista
 *                previa enseña lo que hay, no lo que deberia haber.
 */
export function segmentosDelMensaje(
  cuerpo: string | null,
  numero: string,
  nombre: string,
): SegmentoMensaje[] {
  if (cuerpo === null || cuerpo.trim() === "") return [];

  const datos = {
    ...DATOS_PLANTILLA_EJEMPLO,
    negocio: {
      ...DATOS_PLANTILLA_EJEMPLO.negocio,
      sinpeNumero: numero,
      sinpeNombre: nombre,
    },
  };
  const valores = resolverValoresPlantilla(extraerVariables(cuerpo), datos);
  const texto = renderPlantilla(cuerpo, {
    ...valores,
    sinpe: MARCA_NUMERO,
    sinpe_nombre: MARCA_NOMBRE,
  });

  return partir(texto, numero, nombre);
}

/**
 * Recorre el texto buscando el centinela MAS CERCANO de los dos. Se escribe a mano y no con una
 * regex alternada para no tener que escapar los centinelas: el escapado inline es el error que
 * este repo ya ha pagado varias veces.
 */
function partir(texto: string, numero: string, nombre: string): SegmentoMensaje[] {
  const segmentos: SegmentoMensaje[] = [];
  let resto = texto;

  while (resto.length > 0) {
    const iNumero = resto.indexOf(MARCA_NUMERO);
    const iNombre = resto.indexOf(MARCA_NOMBRE);

    if (iNumero === -1 && iNombre === -1) {
      segmentos.push({ tipo: "texto", texto: resto });
      break;
    }

    const esNumero = iNumero !== -1 && (iNombre === -1 || iNumero < iNombre);
    const corte = esNumero ? iNumero : iNombre;
    const marca = esNumero ? MARCA_NUMERO : MARCA_NOMBRE;

    if (corte > 0) segmentos.push({ tipo: "texto", texto: resto.slice(0, corte) });
    segmentos.push({
      tipo: esNumero ? "numero" : "nombre",
      texto: esNumero ? numero : nombre,
    });
    resto = resto.slice(corte + marca.length);
  }

  return segmentos;
}
