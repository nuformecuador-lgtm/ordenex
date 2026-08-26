"use client";

import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import useSWR from "swr";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FormField } from "@/components/shared/FormField";
import { PasswordInput } from "@/components/shared/PasswordInput";
import {
  actualizarUsuarioSchema,
  crearUsuarioSchema,
  type ActualizarUsuarioResult,
  type CrearUsuarioResult,
} from "@/lib/types/usuario";
import {
  actualizarUsuario,
  crearUsuario,
  listarRoles,
  listarTiposIdentificacion,
} from "@/lib/actions/usuarios";
import { listarZonas } from "@/lib/actions/zonas";
import { listarVehiculos } from "@/lib/actions/vehiculos";
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

/**
 * Rol que este formulario NUNCA asigna: `apiKey` identifica la cuenta de máquina de una
 * integración, que nace en Configuración > API con su key. Es el `value` del catálogo
 * `rol`, no un id.
 */
const ROL_NO_ASIGNABLE = "apiKey";

/** Modo de contraseña inicial (R30/R36). */
type PasswordMode = "manual" | "generate";

type FieldErrors = Record<string, string[]>;

export type UsuarioFormResult = CrearUsuarioResult | ActualizarUsuarioResult;

/** Handle imperativo: el Modal anfitrión dispara el submit async (R27). */
export interface UsuarioFormHandle {
  submit: () => Promise<UsuarioFormResult>;
}

export interface UsuarioFormProps {
  /** "crear" pide el set base + contraseña; "editar" solo campos editables. */
  mode: "crear" | "editar";
  /** Datos actuales del usuario en modo edición (prefill). */
  usuario?: UsuarioPublico | null;
}

interface FormState {
  nombre: string;
  email: string;
  telefono: string;
  tipoIdentificacionId: string;
  cedula: string;
  rolId: string;
  password: string;
  fulfillment: boolean;
  // Feature 24/R27: zona del usuario. "" = sin zona (permitido para
  // mensajero/adminSatelite; el maestro puede asignarla luego).
  zonaId: string;
  // Feature 21: vehiculo asociado. "" = sin vehiculo (permitido: el mensajero puede
  // no tener uno asignado todavia).
  vehiculoId: string;
}

function initialState(usuario?: UsuarioPublico | null): FormState {
  return {
    nombre: usuario?.nombre ?? "",
    email: usuario?.email ?? "",
    telefono: usuario?.telefono ?? "",
    tipoIdentificacionId: usuario?.tipoIdentificacionId ?? "",
    cedula: usuario?.cedula ?? "",
    rolId: usuario?.rolId ?? "",
    password: "",
    fulfillment: usuario?.fulfillment ?? false,
    zonaId: usuario?.zonaId ?? "",
    vehiculoId: usuario?.vehiculoId ?? "",
  };
}

/**
 * Formulario de creación/edición de usuario. Selects de rol (acción `listarRoles`,
 * cuyo `value` es el UUID del catálogo `rol`) y de tipo de documento (acción
 * `listarTiposIdentificacion`, R29). En creación ofrece
 * el toggle de modo de contraseña escribir/generar (R36): en modo generar oculta
 * el input; tras crear con éxito muestra la `generatedPassword` UNA vez con botón
 * copiar y aviso (R33). En edición deshabilita email y cédula (R16). Valida en
 * cliente reusando los schemas de `lib/types/usuario` (no duplica reglas).
 */
export const UsuarioForm = forwardRef<UsuarioFormHandle, UsuarioFormProps>(
  function UsuarioForm({ mode, usuario }, ref) {
    const [form, setForm] = useState<FormState>(() => initialState(usuario));
    const [passwordMode, setPasswordMode] = useState<PasswordMode>("manual");
    const [errors, setErrors] = useState<FieldErrors>({});
    const [generatedPassword, setGeneratedPassword] = useState<string | null>(
      null,
    );
    const [copiado, setCopiado] = useState(false);

    const { data: tipos } = useSWR("usuarios:tipos-identificacion", async () => {
      const res = await listarTiposIdentificacion();
      return res.status === "ok" ? res.tipos : [];
    });

    const tipoOptions: SelectOption[] = useMemo(
      () => (tipos ?? []).map((t) => ({ value: t.id, label: t.value })),
      [tipos],
    );

    const { data: roles } = useSWR("usuarios:roles", async () => {
      const res = await listarRoles();
      return res.status === "ok" ? res.roles : [];
    });

    // `value` = UUID del catálogo `rol` (lo que espera el backend en `rolId`);
    // `label` = nombre legible del rol (p. ej. "maestro").
    //
    // `apiKey` NO se ofrece: no es un rol de persona sino la cuenta de máquina que
    // representa una integración, y se crea desde Configuración > API junto con su key.
    // Si el usuario que se edita YA lo tiene, la opción se conserva —si no, el select
    // aparecería vacío— pero deshabilitada, y el control entero se bloquea abajo.
    const rolOptions: SelectOption[] = useMemo(
      () =>
        (roles ?? [])
          .filter((r) => r.value !== ROL_NO_ASIGNABLE || r.id === form.rolId)
          .map((r) => ({
            value: r.id,
            label: r.value,
            disabled: r.value === ROL_NO_ASIGNABLE,
          })),
      [roles, form.rolId],
    );

    // Feature 24/R27: catálogo de zonas para el select (solo aplica a
    // mensajero/adminSatelite). Hay ~7 zonas; pedimos el máximo permitido
    // (ZONAS_MAX_PAGE_SIZE = 100) para traerlas todas en una página.
    const { data: zonas } = useSWR("usuarios:zonas", async () => {
      const res = await listarZonas({ page: 1, pageSize: 100 });
      return res.status === "ok" ? res.items : [];
    });

    // `value` = id de la zona (lo que espera el backend en `zonaId`);
    // `label` = nombre legible de la zona.
    const zonaOptions: SelectOption[] = useMemo(
      () => (zonas ?? []).map((z) => ({ value: z.id, label: z.nombre })),
      [zonas],
    );

    // Feature 21: catalogo de vehiculos para el select (solo aplica a `mensajero`).
    // Es un catalogo corto y administrable desde Configuracion > Vehiculos.
    const { data: vehiculos } = useSWR("usuarios:vehiculos", async () => {
      const res = await listarVehiculos();
      return res.status === "ok" ? res.items : [];
    });

    // `value` = id del vehiculo (lo que espera el backend en `vehiculoId`);
    // `label` = nombre del tipo (p. ej. "moto").
    const vehiculoOptions: SelectOption[] = useMemo(
      () => (vehiculos ?? []).map((v) => ({ value: v.id, label: v.name })),
      [vehiculos],
    );

    const isEditar = mode === "editar";

    // El switch de fulfillment aplica solo al rol `adminTienda` (R5/R6, decisión P3).
    // `roles` mapea cada `RolItem` como `{ id, value }`; `form.rolId` guarda el UUID.
    const esAdminTienda =
      (roles ?? []).find((r) => r.id === form.rolId)?.value === "adminTienda";

    // Feature 24/R27: la zona solo aplica a `mensajero`/`adminSatelite`; para el
    // resto de roles el service la fuerza a null. Mismo patrón que `esAdminTienda`.
    const rolValue = (roles ?? []).find((r) => r.id === form.rolId)?.value;
    const esRolConZona = rolValue === "mensajero" || rolValue === "adminSatelite";

    // Feature 21: el vehiculo solo aplica a `mensajero` (es quien conduce), y para el
    // es OBLIGATORIO. Para el resto de roles el service lo fuerza a null.
    const esRolConVehiculo = rolValue === "mensajero";

    // Cuenta de integración: su rol no se toca desde aquí. Cambiarlo por accidente la
    // convertiría en un usuario humano y dejaría su API key colgando de un rol que el
    // backend no acepta como dueño.
    const esRolApiKey = rolValue === ROL_NO_ASIGNABLE;

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }

    function validate(): { input: unknown; result?: UsuarioFormResult } {
      // Feature 24/R27: la zona es OBLIGATORIA para mensajero/adminSatelite. Se
      // valida en cliente para feedback inmediato; el service la revalida (fuente
      // de verdad, defensa en profundidad).
      if (esRolConZona && !form.zonaId) {
        return {
          input: null,
          result: {
            status: "validation_error",
            fieldErrors: { zonaId: ["La zona es obligatoria para este rol"] },
          },
        };
      }

      // Feature 21: el vehiculo es OBLIGATORIO para `mensajero` (mismo motivo que la
      // zona: sin el no se le puede asignar una orden). El service lo revalida.
      if (esRolConVehiculo && !form.vehiculoId) {
        return {
          input: null,
          result: {
            status: "validation_error",
            fieldErrors: {
              vehiculoId: ["El vehiculo es obligatorio para el rol mensajero"],
            },
          },
        };
      }

      if (isEditar) {
        const parsed = actualizarUsuarioSchema.safeParse({
          nombre: form.nombre,
          telefono: form.telefono,
          rolId: form.rolId,
          tipoIdentificacionId: form.tipoIdentificacionId,
          // Solo se envía cuando el rol es `adminTienda` (R6/R12); el backend
          // fuerza `false` para otros roles (R4a).
          ...(esAdminTienda ? { fulfillment: form.fulfillment } : {}),
          // Feature 24/R27: zona solo para mensajero/adminSatelite. "" -> null
          // libera la zona; no enviarla la deja intacta. Se omite para el resto
          // de roles (el service la fuerza a null igualmente).
          ...(esRolConZona ? { zonaId: form.zonaId || null } : {}),
          // Feature 21: vehiculo solo para mensajero. "" -> null lo desasocia; se
          // omite para el resto de roles (el service lo fuerza a null igualmente).
          ...(esRolConVehiculo ? { vehiculoId: form.vehiculoId || null } : {}),
        });
        if (!parsed.success) {
          const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
          return { input: null, result: { status: "validation_error", fieldErrors } };
        }
        return { input: parsed.data };
      }

      const base = {
        nombre: form.nombre,
        email: form.email,
        telefono: form.telefono,
        tipoIdentificacionId: form.tipoIdentificacionId,
        cedula: form.cedula,
        rolId: form.rolId,
        // Solo se envía para rol `adminTienda` (R6); si no, se omite (R6).
        ...(esAdminTienda ? { fulfillment: form.fulfillment } : {}),
        // Feature 24/R27: zona solo para mensajero/adminSatelite. "" -> null
        // (permitido; el maestro puede asignarla luego). Se omite para el resto.
        ...(esRolConZona ? { zonaId: form.zonaId || null } : {}),
        // Feature 21: vehiculo solo para mensajero. "" -> null (no es obligatorio;
        // puede asignarse despues). Se omite para el resto de roles.
        ...(esRolConVehiculo ? { vehiculoId: form.vehiculoId || null } : {}),
      };
      const candidate =
        passwordMode === "manual"
          ? { ...base, passwordMode: "manual" as const, password: form.password }
          : { ...base, passwordMode: "generate" as const };
      const parsed = crearUsuarioSchema.safeParse(candidate);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors as FieldErrors;
        return { input: null, result: { status: "validation_error", fieldErrors } };
      }
      return { input: parsed.data };
    }

    async function submit(): Promise<UsuarioFormResult> {
      const { input, result } = validate();
      if (result) {
        setErrors(result.status === "validation_error" ? result.fieldErrors : {});
        return result;
      }

      const res: UsuarioFormResult =
        isEditar && usuario
          ? await actualizarUsuario(usuario.id, input)
          : await crearUsuario(input);

      if (res.status === "validation_error") {
        setErrors(res.fieldErrors);
      } else if (res.status === "conflict") {
        setErrors({ [res.campo]: ["Ya está en uso por otro usuario"] });
      } else {
        setErrors({});
        // R33: la contraseña autogenerada se muestra UNA sola vez.
        if ("generatedPassword" in res && res.generatedPassword) {
          setGeneratedPassword(res.generatedPassword);
        }
      }
      return res;
    }

    useImperativeHandle(ref, () => ({ submit }));

    async function copiar() {
      if (!generatedPassword) return;
      try {
        await navigator.clipboard.writeText(generatedPassword);
        setCopiado(true);
      } catch {
        setCopiado(false);
      }
    }

    // Tras mostrar la contraseña autogenerada, el resto del formulario ya no es
    // editable: la creación terminó y solo queda comunicar el secreto (R33).
    if (generatedPassword) {
      return (
        <div className="flex flex-col gap-3" data-testid="generated-password-panel">
          <p className="text-sm font-medium">Usuario creado correctamente.</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="generated-password">Contraseña generada</Label>
            <div className="flex items-center gap-2">
              <Input
                id="generated-password"
                readOnly
                value={generatedPassword}
                className="font-mono"
                aria-label="Contraseña generada"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copiar}
                aria-label="Copiar contraseña"
              >
                <Copy aria-hidden="true" />
                {copiado ? "Copiada" : "Copiar"}
              </Button>
            </div>
          </div>
          <p role="alert" className="text-sm text-destructive">
            Guárdala ahora: no se volverá a mostrar.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <FormField id="nombre" label="Nombre" error={errors.nombre}>
          <Input
            value={form.nombre}
            onChange={(e) => setField("nombre", e.target.value)}
          />
        </FormField>

        <FormField id="email" label="Email" error={errors.email}>
          <Input
            type="email"
            value={form.email}
            disabled={isEditar}
            onChange={(e) => setField("email", e.target.value)}
          />
        </FormField>

        <FormField id="telefono" label="Teléfono" error={errors.telefono}>
          <Input
            value={form.telefono}
            onChange={(e) => setField("telefono", e.target.value)}
          />
        </FormField>

        <FormField
          id="tipoIdentificacionId"
          label="Tipo de documento"
          error={errors.tipoIdentificacionId}
        >
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              aria-label="Tipo de documento"
              value={form.tipoIdentificacionId}
              options={tipoOptions}
              onValueChange={(v) => setField("tipoIdentificacionId", v)}
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
        </FormField>

        <FormField
          id="cedula"
          label="Número de documento"
          error={errors.cedula}
        >
          <Input
            value={form.cedula}
            disabled={isEditar}
            onChange={(e) => setField("cedula", e.target.value)}
          />
        </FormField>

        <FormField id="rolId" label="Rol" error={errors.rolId}>
          {({
            "aria-invalid": ariaInvalid,
            "aria-describedby": ariaDescribedBy,
          }) => (
            <Select
              aria-label="Rol"
              value={form.rolId}
              options={rolOptions}
              disabled={esRolApiKey}
              onValueChange={(v) => setField("rolId", v)}
              aria-invalid={ariaInvalid}
              aria-describedby={ariaDescribedBy}
            />
          )}
        </FormField>

        {esAdminTienda ? (
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="fulfillment">Esta tienda tiene fulfillment</Label>
            <Switch
              id="fulfillment"
              aria-label="Esta tienda tiene fulfillment"
              checked={form.fulfillment}
              onCheckedChange={(next) => setField("fulfillment", next)}
            />
          </div>
        ) : null}

        {/* Feature 24/R27: la zona solo se muestra (y se envía) para
            mensajero/adminSatelite, y es OBLIGATORIA para esos roles. */}
        {esRolConZona ? (
          <FormField
            id="zonaId"
            label="Zona (obligatoria)"
            error={errors.zonaId}
          >
            {({
              "aria-invalid": ariaInvalid,
              "aria-describedby": ariaDescribedBy,
            }) => (
              <Select
                aria-label="Zona"
                value={form.zonaId}
                options={zonaOptions}
                placeholder="Selecciona una zona"
                onValueChange={(v) => setField("zonaId", v)}
                aria-invalid={ariaInvalid}
                aria-describedby={ariaDescribedBy}
              />
            )}
          </FormField>
        ) : null}

        {/* Feature 21: el vehiculo solo se muestra (y se envia) para `mensajero`,
            y es OBLIGATORIO para ese rol. */}
        {esRolConVehiculo ? (
          <FormField
            id="vehiculoId"
            label="Vehiculo (obligatorio)"
            error={errors.vehiculoId}
          >
            {({
              "aria-invalid": ariaInvalid,
              "aria-describedby": ariaDescribedBy,
            }) => (
              <Select
                aria-label="Vehiculo"
                value={form.vehiculoId}
                options={vehiculoOptions}
                placeholder="Selecciona un vehiculo"
                onValueChange={(v) => setField("vehiculoId", v)}
                aria-invalid={ariaInvalid}
                aria-describedby={ariaDescribedBy}
              />
            )}
          </FormField>
        ) : null}

        {!isEditar ? (
          <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
            <legend className="text-sm font-medium">Contraseña inicial</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="passwordMode"
                  value="manual"
                  checked={passwordMode === "manual"}
                  onChange={() => setPasswordMode("manual")}
                />
                Escribir
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="passwordMode"
                  value="generate"
                  checked={passwordMode === "generate"}
                  onChange={() => setPasswordMode("generate")}
                />
                Generar automáticamente
              </label>
            </div>
            {passwordMode === "manual" ? (
              <FormField id="password" label="Contraseña" error={errors.password}>
                <PasswordInput
                  etiqueta="Contraseña"
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                />
              </FormField>
            ) : (
              <p className="text-sm text-muted-foreground">
                El sistema generará una contraseña segura y la mostrará una sola
                vez tras crear el usuario.
              </p>
            )}
          </fieldset>
        ) : null}
      </div>
    );
  },
);
