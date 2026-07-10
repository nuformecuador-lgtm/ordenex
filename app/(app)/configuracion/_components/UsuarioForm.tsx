"use client";

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import useSWR from "swr";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
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
import type { UsuarioPublico } from "@/lib/interfaces/repositories/IUserRepository";

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
    const rolOptions: SelectOption[] = useMemo(
      () => (roles ?? []).map((r) => ({ value: r.id, label: r.value })),
      [roles],
    );

    const isEditar = mode === "editar";

    function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
      setForm((prev) => ({ ...prev, [key]: value }));
    }

    function validate(): { input: unknown; result?: UsuarioFormResult } {
      if (isEditar) {
        const parsed = actualizarUsuarioSchema.safeParse({
          nombre: form.nombre,
          telefono: form.telefono,
          rolId: form.rolId,
          tipoIdentificacionId: form.tipoIdentificacionId,
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
        <Field id="nombre" label="Nombre" errors={errors.nombre}>
          <Input
            id="nombre"
            value={form.nombre}
            aria-invalid={errors.nombre ? true : undefined}
            onChange={(e) => setField("nombre", e.target.value)}
          />
        </Field>

        <Field id="email" label="Email" errors={errors.email}>
          <Input
            id="email"
            type="email"
            value={form.email}
            disabled={isEditar}
            aria-invalid={errors.email ? true : undefined}
            onChange={(e) => setField("email", e.target.value)}
          />
        </Field>

        <Field id="telefono" label="Teléfono" errors={errors.telefono}>
          <Input
            id="telefono"
            value={form.telefono}
            aria-invalid={errors.telefono ? true : undefined}
            onChange={(e) => setField("telefono", e.target.value)}
          />
        </Field>

        <Field
          id="tipoIdentificacionId"
          label="Tipo de documento"
          errors={errors.tipoIdentificacionId}
        >
          <Select
            aria-label="Tipo de documento"
            value={form.tipoIdentificacionId}
            options={tipoOptions}
            onValueChange={(v) => setField("tipoIdentificacionId", v)}
          />
        </Field>

        <Field id="cedula" label="Número de documento" errors={errors.cedula}>
          <Input
            id="cedula"
            value={form.cedula}
            disabled={isEditar}
            aria-invalid={errors.cedula ? true : undefined}
            onChange={(e) => setField("cedula", e.target.value)}
          />
        </Field>

        <Field id="rolId" label="Rol" errors={errors.rolId}>
          <Select
            aria-label="Rol"
            value={form.rolId}
            options={rolOptions}
            onValueChange={(v) => setField("rolId", v)}
          />
        </Field>

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
              <Field id="password" label="Contraseña" errors={errors.password}>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  aria-invalid={errors.password ? true : undefined}
                  onChange={(e) => setField("password", e.target.value)}
                />
              </Field>
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

/** Envoltorio accesible de un campo con label y errores (i18n vía props). */
function Field({
  id,
  label,
  errors,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {errors && errors.length > 0 ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {errors.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
