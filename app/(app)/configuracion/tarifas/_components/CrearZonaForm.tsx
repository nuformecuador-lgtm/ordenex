"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/shared/FieldError";
import { FormField } from "@/components/shared/FormField";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/hooks/useToast";
import {
  crearZonaSchema,
  type ZonaActionError,
  type ZonaDTO,
} from "@/lib/types/zona";
import {
  crearZona,
  actualizarZona,
  impactoZonaCentral,
} from "@/lib/actions/zonas";
import { crearTarifa, actualizarTarifa } from "@/lib/actions/tarifas";
import {
  actualizarDistritosEspeciales,
  type ProvinciaArbolDTO,
} from "@/lib/actions/geografia";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

import { GeografiaSelector } from "./GeografiaSelector";
import { PAGO_ZONA_TEXTO } from "./tarifas-labels";
import {
  CobroVehiculoTarifas,
  type CobroVehiculoValue,
} from "./CobroVehiculoTarifas";
import {
  TARIFA_CAMPOS_ZONA,
  TarifaCamposGrid,
  hayAlgunValor,
  tarifaValoresVacios,
  validarTarifaCampos,
  type TarifaCampoKey,
  type TarifaFieldErrors,
  type TarifaValores,
} from "./TarifaCampos";

type FieldErrors = Record<string, string[]>;

/**
 * ⭑ FICHA 376 (R20/R21) — LA CONFIRMACIÓN PENDIENTE DE MOVER LA MARCA DE ZONA CENTRAL.
 *
 * Dos direcciones, un solo modal. `marcar` es la que ya existía: esta zona GANA la marca y otra
 * la pierde sin aparecer en ningún payload (R21). `desmarcar` es la que faltaba: la zona que HOY
 * es la central se queda sin ella y el sistema se quedaría sin ninguna (R20).
 *
 * ⚠️ El formulario NO decide: AVISA. Confirmar en `desmarcar` ENVÍA el guardado y el servidor lo
 * rechaza (R5), y ese rechazo se pinta junto a la casilla (R23). La regla vive en UN solo sitio
 * —el servidor—; duplicarla aquí como un `if` que impida enviar sería una segunda copia que un
 * día divergiría (design.md §8 y Q2).
 */
type ConfirmacionCentral =
  | { tipo: "marcar"; pierde: ZonaDTO }
  | { tipo: "desmarcar"; nombreZona: string };

/**
 * ⭑ FICHA 376 (Q4) — el impacto en órdenes de mover la marca, tal como lo ve el modal.
 *
 * `cargando` y `sin_dato` NO son lo mismo que cero: «no afecta a ninguna» y «no lo pude contar»
 * tienen que verse distintos en una confirmación que decide una tarifa.
 */
type ImpactoCentral =
  | { fase: "cargando" }
  | { fase: "listo"; ordenes: number }
  | { fase: "sin_dato" };

/** Valores pre-cargados para editar (o vacíos al crear). */
export interface ZonaFormInitial {
  /** Presente sólo en edición. */
  zonaId?: string;
  nombre: string;
  distritoIds: string[];
  cobro: CobroVehiculoValue;
  /** Marca de zona central (a lo sumo una en true). */
  esCentral?: boolean;
  /**
   * Tarifa de cobro acotada a esta zona y a NINGUNA tienda (`tienda_id` NULL):
   * la fila de `tarifas` que edita la sección "Tarifas de zona". Presente sólo
   * si ya existe.
   */
  tarifaZonaId?: string;
  /** Valores de esa tarifa (strings); vacíos si la zona aún no tiene. */
  tarifaValores?: TarifaValores;
}

export const cobroVacio = (): CobroVehiculoValue => ({
  cobroVehiculo: false,
  tarifas: [{ cobroEntregado: 0, cobroRechazado: 0 }],
});

/**
 * Formulario de crear/editar zona. Compone nombre + selección de distritos
 * (GeografiaSelector) + cobro por vehículo (CobroVehiculoTarifas). Al guardar
 * arma el payload, lo valida contra `crearZonaSchema` (mismo schema que la
 * action) y llama a `crearZona` o `actualizarZona` según el modo. Notifica con
 * toast el éxito/error y avisa al padre con `onSaved` para refrescar la lista.
 */
export function CrearZonaForm({
  mode,
  provincias,
  vehiculos,
  zonas,
  initial,
  onSaved,
  onCancel,
}: {
  mode: "crear" | "editar";
  provincias: ProvinciaArbolDTO[];
  vehiculos: VehiculoDTO[];
  /** Zonas existentes, para verificar si ya hay una marcada como central. */
  zonas: ZonaDTO[];
  initial?: ZonaFormInitial;
  /** Se invoca tras crear/actualizar con éxito (el padre refresca y cierra). */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const esEditar = mode === "editar";

  // Marca de especial que traía el árbol al montar. El guardado envía el DELTA
  // contra esto: sólo los distritos que el usuario tocó, ni uno más.
  const [especialesIniciales] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const p of provincias)
      for (const c of p.cantones)
        for (const d of c.distritos) if (d.zonaEspecial) ids.add(d.id);
    return ids;
  });

  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [distritoIds, setDistritoIds] = useState<string[]>(
    initial?.distritoIds ?? [],
  );
  // Marca de zona especial tal como la reporta el selector. Arranca en `null`
  // (el selector aún no habló) para no confundirlo con "ninguno es especial".
  const [especiales, setEspeciales] = useState<string[] | null>(null);
  const [cobro, setCobro] = useState<CobroVehiculoValue>(
    initial?.cobro ?? cobroVacio(),
  );
  const [esCentral, setEsCentral] = useState<boolean>(initial?.esCentral ?? false);
  // Sección "Tarifas de zona": mismos campos que el formulario de tienda.
  const [tarifaValores, setTarifaValores] = useState<TarifaValores>(
    initial?.tarifaValores ?? tarifaValoresVacios(),
  );
  const [tarifaErrors, setTarifaErrors] = useState<TarifaFieldErrors>({});

  const [errors, setErrors] = useState<FieldErrors>({});
  const [guardando, setGuardando] = useState(false);
  // Id de la zona ya persistida en ESTA sesión del formulario. Existe para que
  // un fallo al guardar la tarifa de zona no deje reintentar creando una zona
  // duplicada: a partir del primer éxito el guardado pasa a ser actualización.
  const [zonaIdGuardada, setZonaIdGuardada] = useState<string | undefined>(
    initial?.zonaId,
  );
  // Igual para la tarifa: tras crearla, el reintento la actualiza.
  const [tarifaZonaId, setTarifaZonaId] = useState<string | undefined>(
    initial?.tarifaZonaId,
  );
  // FICHA 376 (R20/R21): confirmación pendiente de mover la marca de zona central. Si !== null,
  // el modal está abierto y NADA se ha enviado todavía (R22: cancelar cierra y no envía).
  const [confirmacion, setConfirmacion] = useState<ConfirmacionCentral | null>(
    null,
  );
  // FICHA 376 (Q4): cuántas órdenes re-tarifaría ese movimiento. Se pide al abrir el modal.
  const [impacto, setImpacto] = useState<ImpactoCentral>({ fase: "cargando" });

  function setCampoTarifa(key: TarifaCampoKey, value: string) {
    setTarifaValores((prev) => ({ ...prev, [key]: value }));
  }

  /** Arma el candidato y lo valida contra el mismo schema que la action. */
  function validar() {
    const candidate = {
      nombre,
      cobroVehiculo: cobro.cobroVehiculo,
      esCentral,
      distritoIds,
      tarifas: cobro.tarifas,
    };
    return crearZonaSchema.safeParse(candidate);
  }

  /**
   * Valida la sección "Tarifas de zona". Dejarla ENTERA en blanco es válido y
   * significa "esta zona no lleva tarifa propia" (no borra la que hubiera); en
   * cuanto se escribe un campo, rigen las mismas reglas que en el formulario de
   * tienda: todos obligatorios salvo la tarifa especial.
   */
  function validarTarifa():
    | { ok: true; numericos: Record<string, number | null> | null }
    | { ok: false } {
    if (!hayAlgunValor(tarifaValores, TARIFA_CAMPOS_ZONA)) {
      setTarifaErrors({});
      return { ok: true, numericos: null };
    }
    const campos = validarTarifaCampos(tarifaValores, TARIFA_CAMPOS_ZONA);
    if (!campos.ok) {
      setTarifaErrors(campos.errors);
      return { ok: false };
    }
    setTarifaErrors({});
    return { ok: true, numericos: campos.numericos };
  }

  /**
   * Guarda la tarifa acotada a la zona (`zona_id` = la zona, `tienda_id` NULL:
   * aplica a cualquier tienda que no tenga la suya). Devuelve `true` si no había
   * nada que guardar o si se guardó bien.
   */
  async function guardarTarifaZona(
    zonaId: string,
    numericos: Record<string, number | null> | null,
  ): Promise<boolean> {
    if (!numericos) return true;
    const payload = { ...numericos, zonaId, isDefault: false };
    const res = tarifaZonaId
      ? await actualizarTarifa(tarifaZonaId, payload)
      : await crearTarifa(payload);

    if (res.status === "ok") {
      setTarifaZonaId(res.tarifa.id);
      return true;
    }
    if (res.status === "validation_error") setTarifaErrors(res.fieldErrors);
    toast.error(
      "La zona se guardó, pero no se pudo guardar la tarifa de zona.",
    );
    return false;
  }

  /**
   * Persiste la marca `distrito.zona_especial` de los distritos que cambiaron.
   * Como la marca vive en el distrito y no en la zona, al refrescar queda
   * resaltada en TODAS las zonas que contengan ese distrito.
   *
   * Devuelve `true` si no había nada que guardar o si se guardó bien. Un fallo
   * aquí NO tumba el guardado de la zona: avisa y sigue.
   */
  async function guardarEspeciales(): Promise<boolean> {
    if (especiales === null) return true; // el selector no reportó nada aún
    const actuales = new Set(especiales);
    const marcar = [...actuales].filter((id) => !especialesIniciales.has(id));
    const desmarcar = [...especialesIniciales].filter(
      (id) => !actuales.has(id),
    );
    if (marcar.length === 0 && desmarcar.length === 0) return true;

    const res = await actualizarDistritosEspeciales({ marcar, desmarcar });
    if (res.status === "ok") return true;
    toast.error("No se pudo guardar la marca de zona especial.");
    return false;
  }

  /** Envía el payload (crear/actualizar) y maneja resultado/errores. */
  async function enviar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    // Las dos secciones se validan ANTES de tocar el servidor: nada de guardar
    // la zona y descubrir después que la tarifa no pasaba.
    const tarifa = validarTarifa();
    if (!tarifa.ok) return;

    setErrors({});
    setGuardando(true);
    try {
      // Ramas separadas (en vez de un `zonaIdGuardada ? A : B` con `res` único):
      // `ActualizarZonaResult["ok"]` trae `ordenesReconciliadas` y
      // `CrearZonaResult["ok"]` no (T6/R13); estructuralmente uno es asignable
      // al otro (tener una propiedad de más no rompe la asignación), así que
      // anotar `res` con la unión explícita le impide a `tsc` angostarlo por
      // asignación: `res.status === "ok"` cae en la unión de LOS DOS "ok",
      // no en el de la rama que de verdad corrió. Sin anotar el tipo, `tsc`
      // sigue el tipo "evolutivo" de cada asignación y sí distingue las ramas.
      let ordenesReconciliadas = 0;
      // FICHA 377 (R8): el segundo conteo. Las que NO se movieron porque su
      // paquete ya está recibido en una bodega; el servidor las deja con su zona
      // anterior a propósito (R2) y la pantalla tiene que decirlo — informar y no
      // pintarlo sería el mismo fallo mudo que el conteo de arriba vino a cerrar.
      let ordenesRetenidas = 0;
      let res;
      if (zonaIdGuardada) {
        res = await actualizarZona(zonaIdGuardada, parsed.data);
        if (res.status === "ok") {
          ordenesReconciliadas = res.ordenesReconciliadas;
          ordenesRetenidas = res.ordenesRetenidasEnBodegaSatelite;
        }
      } else {
        res = await crearZona(parsed.data);
      }

      if (res.status === "ok") {
        setZonaIdGuardada(res.zona.id);
        if (!(await guardarTarifaZona(res.zona.id, tarifa.numericos))) return;
        // La marca de especial se guarda con la zona ya persistida: si falla,
        // la zona sigue guardada y sólo se avisa de lo que no entró.
        await guardarEspeciales();
        toast.success(
          mensajeGuardado(esEditar, ordenesReconciliadas, ordenesRetenidas),
        );
        onSaved();
        return;
      }

      // Error: validación por campo inline; el resto como toast.
      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      }
      toast.error(mensajeDeError(res));
    } catch {
      toast.error("Ocurrió un error inesperado.");
    } finally {
      setGuardando(false);
    }
  }

  /**
   * ⭑ FICHA 376 (Q4) — abre la confirmación y va a buscar el impacto EN ÓRDENES.
   *
   * El modal se abre YA (no se espera a la consulta) y el número aparece cuando llega: la
   * confirmación es el sitio donde se dice qué cuesta el movimiento, no una pantalla de carga.
   * Mientras tanto el botón de confirmar está bloqueado, para que nadie confirme un impacto que
   * todavía no ha visto. Si la consulta falla, se desbloquea diciendo que no se pudo contar: un
   * fallo de lectura no puede dejar el guardado atrapado.
   *
   * Se pregunta por LAS DOS zonas del traslado —la que pierde la marca y la que la gana—: las dos
   * cambian de columna de flete (`resolverFlete`), y el borde devuelve una entrada por zona
   * pedida, con cero si no tiene ninguna.
   */
  async function pedirConfirmacion(pendiente: ConfirmacionCentral) {
    setConfirmacion(pendiente);
    setImpacto({ fase: "cargando" });

    const ids = [
      ...(pendiente.tipo === "marcar" ? [pendiente.pierde.id] : []),
      ...(zonaIdGuardada ? [zonaIdGuardada] : []),
    ];
    if (ids.length === 0) {
      // Zona todavía sin id (creación): no tiene ni una orden que re-tarifar.
      setImpacto({ fase: "listo", ordenes: 0 });
      return;
    }
    try {
      const res = await impactoZonaCentral(ids);
      if (res.status !== "ok") {
        setImpacto({ fase: "sin_dato" });
        return;
      }
      setImpacto({
        fase: "listo",
        ordenes: res.impacto.reduce((total, i) => total + i.ordenesVivas, 0),
      });
    } catch {
      setImpacto({ fase: "sin_dato" });
    }
  }

  async function guardar() {
    const parsed = validar();
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setErrors({});

    // Si se marca como central, verifica que ninguna otra zona ya lo esté. Si la hay,
    // se pide confirmación (reestablecerá la marca a esta zona).
    if (esCentral) {
      const conflicto = zonas.find(
        (z) => z.esCentral && z.id !== zonaIdGuardada,
      );
      if (conflicto) {
        await pedirConfirmacion({ tipo: "marcar", pierde: conflicto });
        return;
      }
    } else if (initial?.esCentral === true) {
      // FICHA 376 (R20): la rama SIMÉTRICA que faltaba. La zona que se edita es hoy la central y
      // la casilla queda apagada: se pregunta antes de enviar nada, nombrando la zona.
      await pedirConfirmacion({
        tipo: "desmarcar",
        nombreZona: initial.nombre,
      });
      return;
    }

    await enviar();
  }

  return (
    <div className="flex flex-col gap-6 rounded-md border border-border p-4">
      <h3 className="text-sm font-semibold">
        {esEditar ? "Editar zona" : "Nueva zona"}
      </h3>

      <FormField id="nombre-zona" label="Nombre de la zona" error={errors.nombre}>
        <Input
          value={nombre}
          placeholder="Ej: San José centro"
          onChange={(e) => setNombre(e.target.value)}
        />
      </FormField>

      {/* FICHA 376 (R23): el rechazo del servidor por «tiene que haber una zona central» llega
          como `fieldErrors.esCentral` y hasta hoy no se pintaba en ningún sitio. Va JUNTO a la
          casilla, y enlazado por `aria-describedby` para que un lector de pantalla lo anuncie
          como el error de ESTE control y no como un texto suelto. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="es-central-zona"
            checked={esCentral}
            aria-invalid={errors.esCentral ? true : undefined}
            aria-describedby={
              errors.esCentral ? "es-central-zona-error" : undefined
            }
            onCheckedChange={(checked) => setEsCentral(checked === true)}
          />
          <Label htmlFor="es-central-zona" className="cursor-pointer">
            Zona Central
          </Label>
        </div>
        <FieldError id="es-central-zona-error" messages={errors.esCentral} />
      </div>

      <GeografiaSelector
        provincias={provincias}
        initialSelected={initial?.distritoIds}
        onSelectedChange={setDistritoIds}
        onEspecialesChange={setEspeciales}
      />
      {/* Error del GRUPO de distritos (selector geográfico): FieldError suelto. */}
      <FieldError messages={errors.distritoIds} />

      {/* Las dos secciones van lado a lado (6-6 del grid de 12) desde `lg`; por
          debajo se apilan, que es lo único legible en un móvil. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Sección 1: lo que Ordenex PAGA por cada gestión de la zona —al mensajero la entrega,
            a la bodega el rechazo del cliente—.
            La celda es `relative` y la sección se posiciona ABSOLUTA dentro (sólo
            desde `lg`): así no aporta altura, la fila la fija "Tarifas de zona" y
            esta columna nunca queda más alta que la otra —si su contenido no cabe
            (cobro por vehículo con varias filas), scrollea dentro. Por debajo de
            `lg` vuelve al flujo normal y se apila sin recortes. */}
        <div className="relative lg:col-span-6">
          <section className="flex flex-col gap-4 rounded-md border border-border p-4 lg:absolute lg:inset-0 lg:overflow-y-auto">
            {/* Feature 303 — decía «Pago a mensajeros» y «por entrega y por no entrega», y las
                dos cosas estaban mal por el mismo motivo: de los dos montos, sólo el de entrega
                se le paga al mensajero (el del rechazo es ingreso de la BODEGA, `ingreso-bodega
                .ts`), y «no entrega» abarcaba `devuelta` y `reprogramada`, que no pagan nada. */}
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold">{PAGO_ZONA_TEXTO.seccion}</h4>
              <p className="max-w-prose text-xs text-muted-foreground">
                {PAGO_ZONA_TEXTO.seccionAyuda}
              </p>
            </div>

            <CobroVehiculoTarifas
              vehiculos={vehiculos}
              initial={initial?.cobro}
              onChange={setCobro}
            />
            {/* Error del GRUPO de tarifas: FieldError suelto. */}
            <FieldError messages={errors.tarifas} />
          </section>
        </div>

        {/* Sección 2: el mismo formulario de tarifa de tienda, sin el select de
            tienda: aquí la tarifa se acota a la ZONA y no a un dueño. */}
        <section className="flex flex-col gap-4 rounded-md border border-border p-4 lg:col-span-6">
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Tarifas de zona</h4>
            <p className="max-w-prose text-xs text-muted-foreground">
              Lo que se cobra por repartir en esta zona, para cualquier tienda que
              no tenga una tarifa propia. Déjalo todo en blanco si esta zona no
              lleva tarifa propia.
            </p>
          </div>

          {/* Sin `fulfillment` (2026-08-26): el servicio de bodega es un acuerdo con una
              TIENDA, no una propiedad de la zona. El campo omitido viaja como `null` y la
              columna lo admite desde `tarifa_fulfillment_opcional`. */}
          <TarifaCamposGrid
            idPrefix="zona-tarifa"
            campos={TARIFA_CAMPOS_ZONA}
            valores={tarifaValores}
            errors={tarifaErrors}
            onChange={setCampoTarifa}
          />
        </section>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={guardar} loading={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={guardando}
        >
          Cancelar
        </Button>
      </div>

      <Modal
        open={confirmacion !== null}
        onOpenChange={(o) => {
          // R22: cancelar (o cerrar) NO envía nada y ninguna zona cambia.
          if (!o) setConfirmacion(null);
        }}
        title={
          confirmacion?.tipo === "desmarcar"
            ? "Quitar la marca de zona central"
            : "Zona central ya asignada"
        }
        description={confirmacion ? descripcionConfirmacion(confirmacion) : ""}
        confirmLabel="Continuar"
        cancelLabel="Cancelar"
        // Q4: no se confirma un impacto que todavía no se ha visto.
        confirmDisabled={impacto.fase === "cargando"}
        onConfirm={async () => {
          setConfirmacion(null);
          await enviar();
        }}
      >
        {/* Q4: el número vive en el modal, no en el borde. `aria-live` lo anuncia cuando llega,
            porque el modal se abre antes de que la consulta termine. */}
        <p
          aria-live="polite"
          data-testid="impacto-zona-central"
          className="text-sm text-muted-foreground"
        >
          {textoImpacto(impacto)}
        </p>
      </Modal>
    </div>
  );
}

/**
 * ⭑ FICHA 376 (R20/R21) — el texto de la confirmación, en las dos direcciones.
 *
 * `marcar` conserva LITERALMENTE el texto que ya existía (nombra la zona que pierde la marca).
 * `desmarcar` es el nuevo: nombra la zona y advierte que tiene que existir una zona central —sin
 * prometer que el guardado va a pasar, porque no va a pasar: lo rechaza el servidor (R5)—.
 */
function descripcionConfirmacion(confirmacion: ConfirmacionCentral): string {
  if (confirmacion.tipo === "marcar") {
    return `La zona ${confirmacion.pierde.nombre} ya está marcada como Central. Esta acción reestablecerá la zona Central. ¿Desea continuar?`;
  }
  return `La zona ${confirmacion.nombreZona} es hoy la zona Central. Siempre tiene que haber una zona Central: si le quitas la marca sin marcar otra zona, el guardado se rechaza. ¿Desea continuar?`;
}

/**
 * ⭑ FICHA 376 (Q4) — el impacto, en palabras.
 *
 * `impactoZonaCentral` devuelve NÚMEROS y no redacta nada: el texto se compone aquí. Se cuentan
 * las órdenes que todavía no están congeladas en un cierre, que son exactamente las que cambiarían
 * de columna de flete al mover la marca.
 */
function textoImpacto(impacto: ImpactoCentral): string {
  if (impacto.fase === "cargando") {
    return "Calculando cuántas órdenes cambiarían de tarifa…";
  }
  if (impacto.fase === "sin_dato") {
    return "No se pudo calcular cuántas órdenes cambiarían de tarifa.";
  }
  if (impacto.ordenes <= 0) {
    return "Ninguna orden sin cerrar cambia de tarifa de flete.";
  }
  if (impacto.ordenes === 1) {
    return "1 orden sin cerrar pasaría a cobrarse con otra tarifa de flete.";
  }
  return `${impacto.ordenes} órdenes sin cerrar pasarían a cobrarse con otra tarifa de flete.`;
}

/**
 * Mensaje de éxito del guardado. Al crear, siempre "Zona creada": crear nunca
 * reconcilia órdenes ni retiene ninguna (R13). Al editar, si el guardado
 * reubicó órdenes de otra bodega (su distrito ya resolvía otra zona), lo dice
 * con el conteo exacto; con 0 el mensaje queda igual que antes de la 366.
 *
 * ⭑ FICHA 377 (R8/R10) — LA SEGUNDA FRASE, Y POR QUE SOLO APARECE A VECES.
 *
 * `ordenesRetenidas` son las que el servidor dejó a propósito con su zona
 * anterior porque su paquete ya está recibido en una bodega (R2): moverlas de
 * zona las sacaría del listado de quien las tiene y las dejaría sin transición
 * de salida. Decir «se reubicaron 12» y callar que otras 39 no se movieron es
 * el fallo mudo que R8 cierra, así que la frase se añade a la de arriba en vez
 * de sustituirla: los dos conjuntos son DISJUNTOS y los dos números importan.
 *
 * Con `0` retenidas NO se dice nada (R10): un «0 órdenes» en el caso normal
 * —que es la enorme mayoría de los guardados— sería ruido que enseña a ignorar
 * el mensaje justo cuando el número deja de ser 0. Por eso la guarda es
 * `> 0` y no `<= 0`: el texto de antes de esta ficha se conserva LITERAL.
 *
 * Y la causa se nombra en términos de lo que pasa en la bodega, no del modelo:
 * ni «retenidas», ni «custodia», ni «sin dueño» —eso último describe un defecto
 * que este cambio precisamente impide—.
 */
function mensajeGuardado(
  esEditar: boolean,
  ordenesReconciliadas: number,
  ordenesRetenidas: number,
): string {
  if (!esEditar) return "Zona creada";

  const base =
    ordenesReconciliadas > 0
      ? `Zona actualizada (${ordenesReconciliadas} ${
          ordenesReconciliadas === 1 ? "orden reubicada" : "órdenes reubicadas"
        })`
      : "Zona actualizada";

  if (!(ordenesRetenidas > 0)) return base;

  const retenidas =
    ordenesRetenidas === 1
      ? "1 orden no cambió de zona porque su paquete ya está en una bodega."
      : `${ordenesRetenidas} órdenes no cambiaron de zona porque su paquete ya está en una bodega.`;

  return `${base}. ${retenidas}`;
}

/** Mensaje legible para los estados de error de crear/actualizar zona. */
function mensajeDeError(err: ZonaActionError): string {
  switch (err.status) {
    case "validation_error":
      // FICHA 376 (R23): el rechazo de la marca de zona central NO es «el formulario está
      // incompleto» —el formulario estaba completo, la regla lo rechazó—. El motivo lo redacta el
      // servidor y se reenvía TAL CUAL: la casilla lo pinta (FieldError) y el toast lo repite,
      // porque la casilla puede haber quedado fuera de la pantalla al hacer scroll.
      //
      // ⭑ FICHA 392 — el nombre de la zona entra por la MISMA puerta y por el mismo motivo. La
      // zona se imprime en la etiqueta (es la primera parte de `ubicacion`), así que el servidor
      // rechaza el nombre que la fuente no puede imprimir y redacta él el motivo: qué carácter
      // es, su `U+XXXX` y cómo escribirlo bien. Mandar a «revisar los campos» a quien tiene el
      // formulario COMPLETO lo pone a buscar un hueco que no existe.
      //
      // El motivo se reenvía ENTERO, sin recortar: el caso de la letra descompuesta —la que se
      // pinta igual que la de siempre pero está escrita de otra forma— es largo porque explica
      // algo que no se ve en pantalla, y resumirlo lo deja sin la única instrucción que sirve.
      //
      // `nombre` va antes que `esCentral` porque el servidor nunca los devuelve juntos: el corte
      // del nombre vive en `prepararDatos` y la marca de zona central se decide después.
      return (
        err.fieldErrors.nombre?.[0] ??
        err.fieldErrors.esCentral?.[0] ??
        "Revisa los campos: el formulario está incompleto."
      );
    case "conflict":
      return "Ya existe una zona con ese nombre o un distrito ya está asignado.";
    case "unauthenticated":
      return "Tu sesión expiró.";
    case "forbidden":
      return "No tienes permiso para esta acción.";
    case "not_found":
      return "La zona no existe.";
    default:
      return "No se pudo guardar la zona.";
  }
}
