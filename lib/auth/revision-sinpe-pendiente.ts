import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import { puedeEditarAlgunSinpe, type SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

/**
 * ⭑ FICHA 429 (T18, R26/R30/R31) — LA REVISION OBLIGATORIA DEL PRIMER INICIO DE SESION.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * QUE RESUELVE, Y QUE NO
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Devuelve la bodega cuyo SINPE hay que poner delante de ESTA persona, o `null` si no hay nada que
 * pedirle. `null` es la respuesta NORMAL: la mayoria de las cargas del portal no piden nada.
 *
 * Es la TERCERA capa de D3. Las otras dos —la siembra y el campo obligatorio al crear— garantizan
 * que nunca hay un hueco; esta es la unica que consigue que alguien MIRE el numero. Sin ella, ocho
 * bodegas se quedarian con el de la central para siempre y nada lo diria: un SINPE equivocado no
 * produce ningun error, el cliente transfiere y se sabe dias despues por los reclamos.
 *
 * ⚠️ NO BLOQUEA NADA (R28). Esta funcion no decide acceso: devuelve un dato para PINTAR un aviso.
 * Ninguna ruta la consulta para redirigir ni para devolver 403, y la guardia
 * `revision-sinpe-no-bloquea.guardia.test.ts` lo vigila.
 *
 * ⚠️ LOS QUE NO PAGAN NI UNA CONSULTA (R31). `mensajero`, `adminTienda` y las cuentas de API salen
 * por el primer `return` SIN tocar la base. Este resolvedor se llama desde el layout del portal, o
 * sea en CADA carga de CADA pagina: una consulta de mas para quien no puede hacer nada con ella se
 * paga en todas. El test lo afirma contando llamadas al repositorio, no leyendo el codigo.
 */

/** Lo que el aviso necesita para pintarse. Es el MISMO DTO de la pantalla: una forma, no dos. */
export type RevisionSinpePendiente = SinpeBodegaDTO;

/**
 * @param actor  el de la sesion. Se usa su ROL y su `usuarioId`; su `zonaId` NO — la zona que
 *               decide sale de la base (R20), igual que en `SinpeBodegaService`.
 */
export async function resolverRevisionSinpePendiente(
  actor: Actor | null,
  repo: IZonaRepository,
): Promise<RevisionSinpePendiente | null> {
  // R31: quien no puede editar ninguna bodega no recibe el aviso Y no emite ninguna consulta.
  if (actor === null || !puedeEditarAlgunSinpe(actor.rol)) return null;

  const zonaId =
    actor.rol === "adminSatelite"
      ? // Su bodega, la que dice la BASE. `null` = no tiene (estado representable: `usuario.zona_id`
        // es nullable). No se pide nada y no se rompe nada — devolver el aviso de OTRA bodega seria
        // mucho peor que no pedirlo.
        await repo.zonaIdDeUsuario(actor.usuarioId)
      : // `admin` y `maestro` -> LA CENTRAL. Cierra el hueco que el documento verificado nombra: en
        // GAM no hay `adminSatelite`, asi que alli nadie tiene un login que se lo exija y la
        // revision «depende de que un admin entre a configuracion». Es ademas la bodega mas grande
        // (10 de los 19 mensajeros).
        await repo.findCentralZonaId();

  if (zonaId === null) return null;

  const fila = await repo.findSinpeByZona(zonaId);
  // La zona pudo borrarse entre las dos lecturas. No es motivo para romper una carga de pagina.
  if (fila === null) return null;
  // R30: una bodega YA revisada no vuelve a pedir nada, y a NADIE de esa bodega — la marca es de la
  // BODEGA, no de la persona (D2). Dos administradores de la misma bodega no la revisan dos veces.
  if (fila.sinpeRevisadoAt !== null) return null;

  return {
    zonaId: fila.id,
    zonaNombre: fila.nombre,
    esCentral: fila.esCentral,
    numero: fila.sinpeNumero,
    nombre: fila.sinpeNombre,
    revisadoAt: null, // por construccion: si no fuera null, no estariamos aqui
    // Quien recibe el aviso SIEMPRE puede corregirlo en el sitio (R27): se llega hasta aqui solo
    // por una zona que este actor puede editar.
    editable: true,
  };
}
