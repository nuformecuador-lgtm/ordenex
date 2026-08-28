import type { GestionCausaDevolucion } from "@prisma/client";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 87 (T1, design §2.2) — DTO de una NOVEDAD: una orden en estatus `devuelta`
// de la tienda del adminTienda, con su causa de devolucion derivada. 100% serializable
// (strings + number|null + enum string) para cruzar el borde RSC (Server Action ->
// Server Component -> Client Component por props), sin Prisma.Decimal ni Date.
//
// 2026-08-13 (pedido humano) — POR QUE EXTIENDE `MiAsignacionDTO`. `/novedades` monta las
// MISMAS cards POS que el portal del mensajero («En reparto»/«Entregas»), y la decision fue
// que pinten lo mismo: datos del pedido, de la entrega, del cobro y el desplegable «Ver
// detalle completo». Mientras el DTO traia solo ocho de los diecinueve campos que la card
// pide, el adaptador de front (`novedad-a-orden-card.ts`) tenia que rellenar diez con
// `null`/`""` falsos y APAGAR tres secciones; el hueco no era de la pantalla, era del
// contrato.
//
// El precedente es literal y esta a la vista: `RecoleccionOrdenDTO extends MiAsignacionDTO`
// (`lib/types/recoleccion-tienda.ts`), donde se escribio que el recorte del DTO «es hoy la
// unica razon por la que las dos pantallas del portal se ven distintas» y se retiro. Aqui
// aplica igual: los campos salen de la MISMA fila de `orden` que ya se leia, asi que no hay
// lectura nueva contra la base, solo un `select` mas ancho.
//
// Esto DEROGA el criterio anterior de este archivo («el DTO solo crece cuando la pantalla
// PINTA el dato»): la pantalla ahora los pinta todos. Y deroga los `?` que `producto`/`peso`/
// `intentosEntrega` tenian justificados por «patron aditivo»: su obligatoriedad pasa a ser la
// que declare `MiAsignacionDTO` (`producto: string`, `peso: number | null` REQUERIDOS;
// `intentosEntrega?` sigue opcional alli, y el service lo sigue emitiendo SIEMPRE con `?? 0`).
//
// Que NO viaja, y por que (son opcionales en `MiAsignacionDTO`, asi que no emitirlos es
// contrato honesto y no un hueco):
//   - `marcarLuego?`: marca PRIVADA de un mensajero. El actor aqui es el adminTienda; no tiene
//     ninguna, y un `false` fijo seria inventarla.
//
// Feature 227: aqui vivia tambien `notaPrivada?`, con el razonamiento de que el adminTienda «no
// tiene ninguna». Ese razonamiento MURIO: la nota privada del mensajero YA NO EXISTE (se retiro
// con la columna `orden_mensajero_meta.nota`). Lo que la tienda y el mensajero se dicen sobre una
// orden vive ahora en `orden_nota`, un HILO compartido en el que el adminTienda si escribe.
// Ese hilo NO es un campo de este DTO y no lo sera: `/novedades` es un listado PAGINADO y el
// hilo es de tamaño variable, asi que incluirlo costaria una consulta por orden de la pagina
// (N+1) para un dato que solo se mira al ABRIR una orden. Se carga bajo demanda con su propia
// accion de lectura (design §4, R28).
//   - `tiendaTelefono?`: sostiene la cabecera por tienda de `/recoleccion`. Esta pantalla ES
//     la de la tienda dueña: no hay a quien contactar que no sea uno mismo.
// Y `secuenciaRuta` viaja SIEMPRE `null` (es requerido): estas ordenes no son paradas de
// ninguna ruta optimizada, y el modulo monta la card con `mostrarRuta={false}`.
//
// Identificador visible = `numGuia` (decision F1.4 #1). Es NULLABLE (feature 17: la guia
// se asigna en "Generar guia"); la UI muestra un placeholder legible cuando es `null` (R9).
// `numRemision` viaja con el valor REAL de la orden (NOT NULL en el schema): que el front
// sobreescriba ese slot con la etiqueta «Guia N» es decision SUYA (R9), no del contrato.
//
// `causa` = valor `causaDevolucion` de la ultima gestion `devuelta` VIGENTE (R6). Puede
// ser `null` (orden sin gestion vigente, o gestion con causa nula, o devolucion previa a la
// feature 73); la UI lo traduce a "Sin causa registrada" (R7). La traduccion a etiqueta ES
// (`CAUSA_DEVOLUCION_LABEL`) ocurre en el cliente (R11), NO en el DTO.
export interface NovedadDTO extends MiAsignacionDTO {
  causa: GestionCausaDevolucion | null;
  /**
   * Pedido humano 2026-08-18 — intentos de contacto que ESTA tienda lleva registrados sobre la
   * orden (`orden.intentos_contacto`), para el boton «+1 intento de contacto» y su contador.
   *
   * Campo PROPIO de este DTO y no de `MiAsignacionDTO`, igual que `causa`: lo registra y lo mira
   * la tienda desde `/novedades`, y el portal del mensajero no lo pinta en ningun sitio. Meterlo
   * en el contrato compartido obligaria a emitirlo en las dos listas del mensajero para que nadie
   * lo lea.
   *
   * NO confundir con `intentosEntrega` (feature 160/215), que cuenta CIERRES APROBADOS con un
   * resultado de gestion del mensajero. Este cuenta gestos de la TIENDA, se registra a mano y no
   * deriva de ninguna gestion.
   *
   * Es CUMULATIVO: sobrevive a que la solicitud de ayuda se retire y no se reinicia al pedirla de
   * nuevo. Cuenta intentos que ocurrieron, y un historial que se borra al cambiar de estado es un
   * estado, no un historial.
   */
  intentosContacto: number;
  /**
   * FICHA 296 (pedido humano 2026-08-27) — nombre del MENSAJERO de la orden. `null` = la orden no
   * tiene mensajero asignado.
   *
   * EL DEFECTO QUE CIERRA. La tienda veia en `/novedades` una orden pidiendo ayuda y no a quien
   * preguntarle: la card no pintaba ningun mensajero porque el dato NO EXISTIA EN EL CAMINO.
   * `NovedadDTO` extiende `MiAsignacionDTO`, que es el contrato del PORTAL DEL MENSAJERO — alli el
   * mensajero es obvio porque es quien mira, asi que ese DTO no tiene ni un campo suyo. Reusarlo en
   * la pantalla de la TIENDA heredaba ese hueco.
   *
   * CAMPO PROPIO DE ESTE DTO, no del contrato compartido — mismo camino que `causa` e
   * `intentosContacto` y por el mismo motivo: `MiAsignacionDTO` lo consumen tambien las dos listas
   * del portal del mensajero, y meterlo alli obligaria a emitirlo donde nadie lo lee.
   *
   * QUE MENSAJERO ES, que era la decision de fondo. Es el ASIGNADO (`orden.mensajero_asignado_id`),
   * y sobre el grupo `ayuda` eso es tambien QUIEN PIDIO LA AYUDA: las dos personas no pueden
   * separarse mientras la orden repose en `ayuda_tienda` (el argumento completo, con las dos
   * propiedades que lo sostienen, esta en `NovedadOrdenRow.mensajeroNombre`). Se lee de la orden y
   * no del actor de la transicion `solicitud_ayuda_tienda` porque sale de la MISMA consulta que ya
   * se hacia, porque no depende del fallback documentado de `findFechaSolicitudAyuda` (una orden en
   * ayuda sin transicion de solicitud tendria mensajero pero no actor), y porque en el grupo
   * `devolucion` —donde no hay ninguna solicitud— sigue significando algo: quien trae el paquete de
   * vuelta, hasta que se libere a bodega.
   *
   * REQUERIDO (sin `?`), como `causa` e `intentosContacto`: quien produzca un `NovedadDTO` tiene
   * que decidir que mensajero pone. Un `?` dejaria que un productor nuevo se olvidara y la card
   * volviera a no decir nada, que es exactamente el defecto que esta ficha cierra.
   *
   * SOLO EL NOMBRE. Ni telefono ni id: el telefono del mensajero es PII de un tercero y ponerlo
   * aqui seria abrir un canal de contacto directo tienda->mensajero que nadie ha pedido ni
   * decidido. El hilo de `orden_nota` ya es la via de contacto sobre la orden.
   */
  mensajeroNombre: string | null;
}
