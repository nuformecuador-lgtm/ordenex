"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Modal } from "@/components/shared/Modal";
import { SinpeAvisoRiesgo } from "@/components/shared/SinpeAvisoRiesgo";
import { SinpeCampos } from "@/components/shared/SinpeCampos";
import {
  fechaRevisionCR,
  SINPE_OFICINA,
  SIN_DATO,
} from "@/components/shared/sinpe-textos";
import { useToast } from "@/hooks/useToast";
import { guardarSinpeBodega } from "@/lib/actions/sinpe-bodega";
import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";
import { messageFromActionError } from "@/lib/utils/action-error-message";

/**
 * ⭑ FICHA 429 (T21-B) — «SINPE por bodega»: LAS OCHO BODEGAS EN UNA TABLA.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ «SIN REVISAR» ES UN AVISO, NO UN ERROR. Y LA DIFERENCIA NO ES DE TONO.
 * ═════════════════════════════════════════════════════════════════════════════════════════════
 * Una bodega que sigue con la semilla tiene un numero PERFECTAMENTE VALIDO: el de la central. No
 * hay nada roto. Lo que pasa es que esa plata entra a la central y no a la bodega, que es una
 * decision de negocio que alguien tiene que tomar, no un defecto que alguien tenga que arreglar.
 *
 * Pintarlo como error dejaria a la oficina con OCHO alarmas rojas la mañana del despliegue —las
 * ocho a la vez, todas por lo mismo, ninguna accionable en el momento—, y una alarma que sale
 * ocho veces el primer dia se aprende a ignorar antes de que llegue la que si importa. Por eso el
 * chip es `warning` y hay una nota bajo la tabla que dice exactamente que significa.
 *
 * ⚠️ LA EDICION VIVE EN UN MODAL Y NO EN LA FILA. El cambio decide a que cuenta va el dinero de
 * una bodega entera: un campo editable en la fila se toca al pasar, y el modal obliga a un gesto
 * deliberado. Es el ultimo recurso que `DESIGN.md` permite, y aqui se agota la alternativa
 * inline a proposito.
 *
 * ⚠️ `editable` LO DECIDE EL SERVIDOR (R20) y llega en el DTO. Este componente solo lo obedece:
 * un `editable` calculado aqui seria un permiso viajando por el cliente.
 */
export function SinpeBodegasModule({
  bodegasIniciales,
}: Readonly<{ bodegasIniciales: SinpeBodegaDTO[] }>) {
  const toast = useToast();

  const [bodegas, setBodegas] = useState(bodegasIniciales);
  // `null` = no hay nada abierto y NADA se ha enviado. La edicion es por bodega, y el modal
  // guarda su propio borrador para que cerrarlo no deje a medias la fila de la tabla.
  const [edicion, setEdicion] = useState<{
    bodega: SinpeBodegaDTO;
    numero: string;
    nombre: string;
  } | null>(null);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [guardando, setGuardando] = useState(false);

  function abrir(bodega: SinpeBodegaDTO) {
    setEdicion({ bodega, numero: bodega.numero, nombre: bodega.nombre });
    setErrores({});
  }

  function cerrar() {
    setEdicion(null);
    setErrores({});
  }

  async function guardar() {
    if (edicion === null) return;
    setGuardando(true);
    try {
      const res = await guardarSinpeBodega(edicion.bodega.zonaId, {
        numero: edicion.numero,
        nombre: edicion.nombre,
      });
      if (res.status === "ok") {
        const guardada = res.bodega;
        setBodegas((previas) =>
          previas.map((b) => (b.zonaId === guardada.zonaId ? guardada : b)),
        );
        toast.success(`SINPE de ${guardada.zonaNombre} guardado.`);
        cerrar();
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

  const columnas: Column<SinpeBodegaDTO>[] = [
    {
      id: "zonaNombre",
      value: SINPE_OFICINA.columnaBodega,
      minWidth: "12rem",
      render: (b) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{b.zonaNombre}</span>
          {b.esCentral ? (
            <Badge variant="info">{SINPE_OFICINA.chipCentral}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "numero",
      value: SINPE_OFICINA.columnaNumero,
      minWidth: "9rem",
      // Mono: ocho dígitos se comparan mirándolos en columna, y con tipografía proporcional dos
      // números distintos ocupan el mismo ancho y se leen iguales de reojo.
      render: (b) => <span className="font-mono tracking-wide">{b.numero}</span>,
    },
    {
      id: "nombre",
      value: SINPE_OFICINA.columnaNombre,
      minWidth: "12rem",
    },
    {
      id: "revisadoAt",
      value: SINPE_OFICINA.columnaRevision,
      minWidth: "12rem",
      render: (b) =>
        b.revisadoAt === null ? (
          <Badge variant="warning">{SINPE_OFICINA.chipSinRevisar}</Badge>
        ) : (
          <span>{fechaRevisionCR(b.revisadoAt)}</span>
        ),
    },
    {
      id: "acciones",
      value: SINPE_OFICINA.columnaAcciones,
      align: "right",
      render: (b) =>
        b.editable ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            // El nombre accesible identifica SU fila: ocho botones llamados «Editar» son ocho
            // botones indistinguibles para quien navega con lector de pantalla.
            aria-label={`Editar el SINPE de ${b.zonaNombre}`}
            onClick={() => abrir(b)}
          >
            {SINPE_OFICINA.editar}
          </Button>
        ) : (
          <span className="text-muted-foreground">{SIN_DATO}</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* El aviso de encabezado lleva el acento de MARCA y no un semántico: no avisa de un
          riesgo ni de un estado, explica de qué va la pantalla. El riesgo tiene su propio
          bloque `warning` más abajo, y mezclarlos le quitaría fuerza al que sí lo es. */}
      <p className="max-w-prose rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-card-foreground">
        {SINPE_OFICINA.aviso}
      </p>

      <DataTable<SinpeBodegaDTO>
        columns={columnas}
        data={bodegas}
        rowKey="zonaId"
        caption={SINPE_OFICINA.tablaCaption}
        emptyMessage={SINPE_OFICINA.vacio}
      />

      <p className="max-w-prose text-xs text-muted-foreground">
        {SINPE_OFICINA.notaSinRevisar}
      </p>

      <SinpeAvisoRiesgo />

      <Modal
        open={edicion !== null}
        onOpenChange={(abierto) => {
          if (!abierto) cerrar();
        }}
        title={
          edicion === null
            ? SINPE_OFICINA.titulo
            : `SINPE de ${edicion.bodega.zonaNombre}`
        }
        description={SINPE_OFICINA.aviso}
        size="md"
        confirmLabel={guardando ? "Guardando…" : "Guardar"}
        cancelLabel="Cancelar"
        // `closeOnConfirm={false}`: el cierre lo decide `guardar()`, que solo cierra cuando el
        // servidor dice «ok». Con el cierre automático, un `validation_error` se llevaría por
        // delante el modal y el error del campo no llegaría a verse nunca.
        closeOnConfirm={false}
        onConfirm={guardar}
      >
        {edicion === null ? null : (
          <div className="flex flex-col gap-4">
            <SinpeCampos
              idPrefijo="sinpe-oficina"
              numero={edicion.numero}
              nombre={edicion.nombre}
              errores={errores}
              disabled={guardando}
              onNumeroChange={(numero) =>
                setEdicion((actual) =>
                  actual === null ? actual : { ...actual, numero },
                )
              }
              onNombreChange={(nombre) =>
                setEdicion((actual) =>
                  actual === null ? actual : { ...actual, nombre },
                )
              }
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
