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
//   - `marcarLuego?` / `notaPrivada?`: marcas PRIVADAS de un mensajero. El actor aqui es el
//     adminTienda; no tiene ninguna, y un `false`/`null` fijo seria inventarlas.
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
}
