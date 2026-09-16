"use client";

import { useState } from "react";

import { Modal } from "@/components/shared/Modal";
import { SinpeCampos } from "@/components/shared/SinpeCampos";
import { SINPE_REVISION } from "@/components/shared/sinpe-textos";
import { useToast } from "@/hooks/useToast";
import {
  confirmarSinpeBodega,
  guardarSinpeBodega,
} from "@/lib/actions/sinpe-bodega";
import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";
import { messageFromActionError } from "@/lib/utils/action-error-message";

/**
 * ⭑ FICHA 429 (T22 — R26, R27, R28, R29, R30) — EL AVISO DEL PRIMER INGRESO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * QUE ES, Y QUE NO ES
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Es la TERCERA capa de D3. Las otras dos —la siembra y el campo obligatorio al crear— garantizan
 * que nunca hay un hueco; esta es la unica que consigue que alguien MIRE el numero. Sin ella, las
 * ocho bodegas se quedarian con el de la central para siempre y nada lo diria.
 *
 * ⚠️ NO BLOQUEA NADA, NUNCA (R28). Se monta como HERMANO del contenido en `app/(app)/layout.tsx`,
 * al lado de `PushReactivacion`, jamas envolviendolo: un envoltorio PUEDE dejar de pintar
 * `{children}` con un `return null`; un hermano no tiene donde hacerlo. Eso es lo que hace R28
 * estructural en vez de una promesa, y la guardia `revision-sinpe-no-bloquea.guardia.test.ts` lo
 * vigila sobre la forma del arbol.
 *
 * ⚠️ «AHORA NO» EXISTE A PROPOSITO Y NO SE QUITA. Un bloqueo duro garantiza la revision y
 * garantiza TAMBIEN que un fallo de esta pantalla deje a una bodega entera sin poder trabajar. La
 * condicion D8 —«no dañar lo que ya funciona»— manda: la insistencia se paga con volver a
 * preguntar en el siguiente ingreso, no con cerrar la puerta. Y el coste de aplazarlo es, en el
 * peor caso, exactamente lo que el cliente ve hoy: el numero de la central.
 *
 * ⚠️ CERRARLO NO CONFIRMA NADA (R29). La bodega sigue SIN revisar —no se llama a ninguna accion—
 * y el aviso vuelve en el SIGUIENTE INICIO DE SESION, no en la siguiente navegacion. La
 * diferencia importa: un aviso que reaparece al cambiar de pantalla se cierra por reflejo a los
 * tres minutos y deja de decir nada.
 *
 * COMO SE RECUERDA «ya lo cerre en esta sesion»: `sessionStorage`. Y no `localStorage` ni una
 * cookie, porque la propiedad que hay que cumplir es LITERALMENTE la de `sessionStorage` — muere
 * al cerrar la pestaña y no viaja al servidor. Con `localStorage` el aviso no volveria nunca en
 * ese navegador, que es la alternativa descartada en `design.md §6.2`.
 *
 * ⚠️ LA MARCA SE ESCRIBE AL CERRAR, NO AL ABRIR. Si se escribiera al montar, una recarga a mitad
 * de la carga —o un fallo del componente— consumiria el unico aviso de esa sesion sin que nadie
 * lo hubiera visto.
 *
 * ⚠️ NO SE MONTA MAS DE UNA VEZ EN EL ARBOL. Es un aviso por CARGA del portal, y el layout es el
 * unico sitio donde eso es cierto (mismo motivo que `PushReactivacion`).
 */
export interface RevisionSinpeBodegaProps {
  /** La bodega a revisar, resuelta EN EL SERVIDOR por `resolverRevisionSinpePendiente`. */
  bodega: SinpeBodegaDTO;
}

/**
 * Clave de la marca de sesion. Lleva el id de la ZONA: quien administra dos bodegas —hoy no pasa,
 * pero el modelo lo permite— tiene que poder aplazar una sin aplazar la otra.
 */
function claveDeSesion(zonaId: string): string {
  return `ordenex:sinpe-revision-aplazada:${zonaId}`;
}

/** `true` si en ESTA sesion ya se cerro el aviso de esa bodega. */
function yaAplazadoEnEstaSesion(zonaId: string): boolean {
  // `try`: `sessionStorage` lanza en modo privado de algunos navegadores y con cookies de
  // terceros bloqueadas. Un almacenamiento inaccesible no puede impedir que el aviso se vea —
  // como mucho hace que reaparezca, que es el lado seguro del fallo.
  try {
    return window.sessionStorage.getItem(claveDeSesion(zonaId)) !== null;
  } catch {
    return false;
  }
}

function marcarAplazadoEnEstaSesion(zonaId: string): void {
  try {
    window.sessionStorage.setItem(claveDeSesion(zonaId), "1");
  } catch {
    // Sin almacenamiento, el aviso vuelve en la siguiente navegacion. Es molesto y es correcto:
    // la alternativa es no volver a pedirlo nunca.
  }
}

export function RevisionSinpeBodega({
  bodega,
}: Readonly<RevisionSinpeBodegaProps>) {
  const toast = useToast();

  // El estado inicial se calcula en el PRIMER render del cliente (inicializador perezoso de
  // `useState`), no en un efecto: con un efecto el modal se pintaria y desapareceria de golpe en
  // cada navegacion de una sesion ya aplazada.
  const [abierto, setAbierto] = useState<boolean>(
    () => !yaAplazadoEnEstaSesion(bodega.zonaId),
  );
  const [numero, setNumero] = useState(bodega.numero);
  const [nombre, setNombre] = useState(bodega.nombre);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [guardando, setGuardando] = useState(false);

  const sinCambios = numero === bodega.numero && nombre === bodega.nombre;

  /**
   * R27 — se corrige EN EL SITIO, sin abandonar la pantalla en la que la persona estaba.
   * Mandarla a otra pantalla es un paso donde la gente se cae, y quien acaba de ver que el numero
   * esta mal es exactamente quien puede arreglarlo en ese segundo.
   *
   * R25 — si no cambio nada, se CONFIRMA: la bodega queda revisada y NO se escribe fila de
   * historial. Una confirmacion no cambia nada y no mueve dinero; meterla en el registro del
   * dinero lo convertiria en un registro de visitas.
   */
  async function confirmar() {
    setGuardando(true);
    try {
      const res = sinCambios
        ? await confirmarSinpeBodega(bodega.zonaId)
        : await guardarSinpeBodega(bodega.zonaId, { numero, nombre });

      if (res.status === "ok") {
        setErrores({});
        // Confirmada la bodega, el aviso NO vuelve para nadie de esa bodega (R30): la marca es de
        // la BODEGA y no de la persona, y la decide el servidor. La marca de sesion se pone
        // igualmente por si la persona sigue navegando sin recargar.
        marcarAplazadoEnEstaSesion(bodega.zonaId);
        setAbierto(false);
        toast.success(`SINPE de ${bodega.zonaNombre} confirmado.`);
        return;
      }
      if (res.status === "validation_error") {
        setErrores(res.fieldErrors);
        return;
      }
      setErrores({});
      toast.error(messageFromActionError(res));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  /** «Ahora no»: NO llama a ninguna accion. La bodega sigue sin revisar (R29). */
  function ahoraNo() {
    marcarAplazadoEnEstaSesion(bodega.zonaId);
    setErrores({});
    setAbierto(false);
  }

  return (
    <Modal
      open={abierto}
      onOpenChange={(sigueAbierto) => {
        // Cerrar por Escape, por el overlay o por «Ahora no» es LO MISMO: aplazar. No hay una
        // salida del modal que confirme sin que la persona pulse «Confirmar».
        if (!sigueAbierto) ahoraNo();
      }}
      title={`${SINPE_REVISION.tituloPrefijo} ${bodega.zonaNombre}`}
      description={SINPE_REVISION.cuerpo}
      size="md"
      confirmLabel={SINPE_REVISION.confirmar}
      cancelLabel={SINPE_REVISION.ahoraNo}
      onCancel={ahoraNo}
      // El cierre lo decide `confirmar()`, que solo cierra cuando el servidor dice «ok»: con el
      // cierre automatico, un `validation_error` se llevaria el modal por delante y el error del
      // campo no llegaria a verse.
      closeOnConfirm={false}
      onConfirm={confirmar}
    >
      <div className="flex flex-col gap-4">
        <SinpeCampos
          idPrefijo="revision-sinpe"
          numero={numero}
          nombre={nombre}
          errores={errores}
          disabled={guardando}
          autoFocus
          onNumeroChange={setNumero}
          onNombreChange={setNombre}
        />
      </div>
    </Modal>
  );
}
