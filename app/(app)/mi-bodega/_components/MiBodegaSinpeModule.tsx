"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SinpeAvisoRiesgo } from "@/components/shared/SinpeAvisoRiesgo";
import { SinpeCampos } from "@/components/shared/SinpeCampos";
import { SinpeMensajePreview } from "@/components/shared/SinpeMensajePreview";
import {
  fechaRevisionCR,
  SINPE_MI_BODEGA,
} from "@/components/shared/sinpe-textos";
import { useToast } from "@/hooks/useToast";
import { guardarSinpeBodega } from "@/lib/actions/sinpe-bodega";
import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";
import { messageFromActionError } from "@/lib/utils/action-error-message";

/**
 * ⭑ FICHA 429 (T21-A) — `/mi-bodega`: LOS DOS CAMPOS Y, AL LADO, EL MENSAJE QUE VA A LEER EL
 * CLIENTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * LA DECISION DE DISEÑO QUE MANDA SOBRE EL RESTO
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * La pantalla no es «un formulario de dos campos»: es un formulario PEGADO a la frase real que el
 * cliente recibe, con el numero y el titular resaltados dentro de ella. Sin esa mitad derecha,
 * nada en esta pantalla distingue un numero correcto de uno valido pero ajeno — y esa distincion
 * es la ficha entera.
 *
 * ⚠️ LOS DATOS BAJAN POR PROPS DESDE EL SERVIDOR. No hay un `fetch` ni un SWR aqui: el Server
 * Component padre ya resolvio al actor y ya trae la bodega con su `editable` decidido en el
 * servidor (R20). Pedirlo otra vez desde el navegador seria una ida y vuelta mas por carga para
 * un dato que el servidor tiene en la mano, y un `editable` calculado aqui seria un permiso
 * viajando por el cliente.
 *
 * ⚠️ EL GUARDADO ES UNA SERVER ACTION, no un `fetch` a `/api/*`: es una mutacion interna desde un
 * componente propio. Y el `validation_error` se pinta JUNTO AL CAMPO —no como un toast— porque un
 * «revisá los datos» generico no dice cual de los dos numeros esta mal.
 *
 * LIMITE DECLARADO SOBRE «QUIEN LO CAMBIO». El pie de la tarjeta dice la FECHA de la ultima
 * revision y no la persona, porque la persona NO esta en `SinpeBodegaDTO`: vive en
 * `historial_accion`, cuya lectura es `maestro`-only, y ademas una confirmacion SIN cambios no
 * deja fila (R25) — asi que para la mitad de los casos no habria «quien» que enseñar. Se pinta lo
 * que existe y se dice donde esta lo demas (el aviso de abajo nombra el registro).
 */
export function MiBodegaSinpeModule({
  bodega,
  cuerpoPlantilla,
}: Readonly<{
  bodega: SinpeBodegaDTO;
  /** Cuerpo real de la plantilla que lleva el par. `null` = no se pudo leer. */
  cuerpoPlantilla: string | null;
}>) {
  const toast = useToast();

  // El par GUARDADO, que es contra lo que «Cancelar» revierte y lo que se pinta en el pie. Se
  // actualiza solo cuando el servidor confirma: hasta entonces, lo vigente es lo de antes.
  const [guardado, setGuardado] = useState({
    numero: bodega.numero,
    nombre: bodega.nombre,
    revisadoAt: bodega.revisadoAt,
  });
  const [numero, setNumero] = useState(bodega.numero);
  const [nombre, setNombre] = useState(bodega.nombre);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [guardando, setGuardando] = useState(false);

  const sinCambios = numero === guardado.numero && nombre === guardado.nombre;

  async function guardar() {
    setGuardando(true);
    try {
      const res = await guardarSinpeBodega(bodega.zonaId, { numero, nombre });
      if (res.status === "ok") {
        setErrores({});
        setGuardado({
          numero: res.bodega.numero,
          nombre: res.bodega.nombre,
          revisadoAt: res.bodega.revisadoAt,
        });
        // El servidor NORMALIZA el numero (`8888 1111` -> `88881111`): se repinta lo que quedó
        // guardado de verdad, no lo que se tecleó. Enseñar lo tecleado dejaría la pantalla
        // diciendo una cosa y la base otra.
        setNumero(res.bodega.numero);
        setNombre(res.bodega.nombre);
        toast.success("SINPE guardado.");
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

  function cancelar() {
    setNumero(guardado.numero);
    setNombre(guardado.nombre);
    setErrores({});
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Las dos piezas son HERMANAS y no una dentro de otra (DESIGN.md, «Cards»). Desde `lg`
          van lado a lado con la tarjeta acotada a ~520px, que es el ancho en el que los dos
          campos siguen siendo legibles sin estirarse; por debajo se apilan, que es lo único
          legible en un teléfono — y este rol trabaja desde el teléfono. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Card className="w-full lg:max-w-[520px] lg:shrink-0">
          <CardHeader>
            <CardTitle>{SINPE_MI_BODEGA.titulo}</CardTitle>
            <CardDescription>{SINPE_MI_BODEGA.ayuda}</CardDescription>
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            <SinpeCampos
              idPrefijo="mi-bodega-sinpe"
              numero={numero}
              nombre={nombre}
              errores={errores}
              disabled={guardando || !bodega.editable}
              onNumeroChange={setNumero}
              onNombreChange={setNombre}
            />

            {bodega.editable ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  onClick={guardar}
                  loading={guardando}
                  disabled={sinCambios}
                >
                  {SINPE_MI_BODEGA.guardar}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelar}
                  disabled={guardando || sinCambios}
                >
                  {SINPE_MI_BODEGA.cancelar}
                </Button>
              </div>
            ) : null}
          </CardContent>

          <Separator />

          <CardFooter>
            <p className="text-xs text-muted-foreground">
              {guardado.revisadoAt === null
                ? SINPE_MI_BODEGA.sinRevisar
                : `${SINPE_MI_BODEGA.ultimaRevision} ${fechaRevisionCR(guardado.revisadoAt)}`}
            </p>
          </CardFooter>
        </Card>

        <div className="w-full lg:flex-1">
          <SinpeMensajePreview
            cuerpoPlantilla={cuerpoPlantilla}
            numero={numero}
            nombre={nombre}
          />
        </div>
      </div>

      <SinpeAvisoRiesgo />
    </div>
  );
}
