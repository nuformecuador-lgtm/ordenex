"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/shared/FieldError";
import type { RolValue } from "@prisma/client";
import type { DestinatarioPreviewDTO, PreviewDestinatariosDTO } from "@/lib/types/envios-whatsapp";

import { ROLES_EN_PANTALLA, etiquetaRol } from "./envios-textos";

/** Cuántas coincidencias de la búsqueda se enseñan a la vez (el resto se encuentra escribiendo más). */
const MAX_COINCIDENCIAS = 8;

function normalizar(t: string): string {
  return t.toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export interface DestinatariosFieldProps {
  /** Todas las personas que PUEDEN recibir (activas, de un rol permitido): el catálogo de la búsqueda. */
  personas: readonly DestinatarioPreviewDTO[];
  roles: readonly RolValue[];
  usuarioIds: readonly string[];
  onCambiar: (sel: { roles: RolValue[]; usuarioIds: string[] }) => void;
  /** La lista RESUELTA de la selección actual (R17), o `null` mientras se calcula. */
  preview: PreviewDestinatariosDTO | null;
  /** El informe elegido NO puede llegar a un admin de tienda (enmienda R16). */
  informeNoAptoAdminTienda: boolean;
  errores?: string[];
}

/**
 * Ficha 474 — «A quién» (R16, R17). Roles con su conteo (incluido «Admin de tienda», como la maqueta
 * aprobada), personas sueltas con búsqueda por nombre o por los últimos dígitos del teléfono, y la
 * lista RESUELTA y deduplicada antes de guardar con un aviso por teléfono que no sirve y por
 * teléfono compartido. Los avisos NO bloquean el guardado (R17): «Se puede guardar igual».
 */
export function DestinatariosField({
  personas,
  roles,
  usuarioIds,
  onCambiar,
  preview,
  informeNoAptoAdminTienda,
  errores,
}: DestinatariosFieldProps) {
  const [busqueda, setBusqueda] = useState("");
  const busquedaId = useId();
  const resultadosId = useId();

  const conteoPorRol = useMemo(() => {
    const m = new Map<RolValue, number>();
    for (const p of personas) m.set(p.rol, (m.get(p.rol) ?? 0) + 1);
    return m;
  }, [personas]);

  const porId = useMemo(() => new Map(personas.map((p) => [p.usuarioId, p])), [personas]);

  const coincidencias = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (q === "") return [];
    const digitos = q.replace(/\D/g, "");
    return personas
      .filter((p) => !usuarioIds.includes(p.usuarioId))
      .filter(
        (p) =>
          normalizar(p.nombre).includes(q) ||
          (digitos.length > 0 && p.telefonoEnmascarado.replace(/\D/g, "").includes(digitos)),
      )
      .slice(0, MAX_COINCIDENCIAS);
  }, [busqueda, personas, usuarioIds]);

  function alternarRol(rol: RolValue, marcado: boolean) {
    const siguiente = marcado ? [...roles, rol] : roles.filter((r) => r !== rol);
    onCambiar({ roles: siguiente, usuarioIds: [...usuarioIds] });
  }

  function agregarPersona(id: string) {
    onCambiar({ roles: [...roles], usuarioIds: [...usuarioIds, id] });
    setBusqueda("");
  }

  function quitarPersona(id: string) {
    onCambiar({ roles: [...roles], usuarioIds: usuarioIds.filter((u) => u !== id) });
  }

  const eligeAdminTienda =
    roles.includes("adminTienda") || usuarioIds.some((id) => porId.get(id)?.rol === "adminTienda");

  const sinTelefono = preview?.destinatarios.filter((d) => !d.telefonoValido) ?? [];
  const compartidos = preview?.destinatarios.filter((d) => d.telefonoCompartido) ?? [];
  const porRolElegido = preview?.destinatarios.filter((d) => roles.includes(d.rol)).length ?? 0;
  const solosElegidos = (preview?.total ?? 0) - porRolElegido;

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Roles</legend>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {ROLES_EN_PANTALLA.map(({ rol, etiqueta }) => {
            const n = conteoPorRol.get(rol) ?? 0;
            // Base UI nombra la casilla con la `<label>` que la envuelve (`aria-labelledby`), así
            // que el nombre accesible es el texto de la fila: la etiqueta y el conteo
            // («Admin de tienda, 14 personas»); la píldora visible no se lee dos veces.
            return (
              <label key={rol} className="flex min-h-11 items-center gap-2.5 text-sm sm:min-h-9">
                <Checkbox checked={roles.includes(rol)} onCheckedChange={(c) => alternarRol(rol, c === true)} />
                <span>{etiqueta}</span>
                <span className="sr-only">{`, ${n} ${n === 1 ? "persona" : "personas"}`}</span>
                <span aria-hidden="true" className="rounded-full bg-muted px-2 text-xs text-muted-foreground">
                  {n}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={busquedaId} className="text-sm font-medium">
          Además, estas personas
        </label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={busquedaId}
            className="pl-8"
            placeholder="Buscar por nombre o teléfono"
            value={busqueda}
            aria-controls={resultadosId}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        {busqueda.trim() !== "" ? (
          <ul id={resultadosId} aria-label="Personas que coinciden" className="rounded-lg border border-border bg-popover p-1">
            {coincidencias.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">Nadie coincide con la búsqueda.</li>
            ) : (
              coincidencias.map((p) => (
                <li key={p.usuarioId}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-9"
                    onClick={() => agregarPersona(p.usuarioId)}
                  >
                    <span>
                      {p.nombre} <span className="text-muted-foreground">({etiquetaRol(p.rol)})</span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{p.telefonoEnmascarado}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {usuarioIds.length > 0 ? (
          <ul aria-label="Personas elegidas" className="flex flex-wrap gap-1.5">
            {usuarioIds.map((id) => {
              const nombre = porId.get(id)?.nombre ?? "Usuario no disponible";
              return (
                <li key={id} className="flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-1 pl-2.5 text-sm">
                  {nombre}
                  <button
                    type="button"
                    aria-label={`Quitar a ${nombre}`}
                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={() => quitarPersona(id)}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {informeNoAptoAdminTienda && eligeAdminTienda ? (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger-strong">
          Este informe no se puede enviar a un admin de tienda: lleva datos de varias tiendas. Quita el rol
          «Admin de tienda» y a las personas con ese rol.
        </p>
      ) : null}

      <div className="border-t border-border pt-3" aria-live="polite">
        {preview === null ? (
          <p className="text-sm text-muted-foreground">Calculando quiénes lo recibirán…</p>
        ) : (
          <>
            <p className="text-sm">
              Lo recibirán <strong>{preview.total === 1 ? "1 persona" : `${preview.total} personas`}</strong>
              {preview.total > 0 && roles.length > 0 && solosElegidos > 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({porRolElegido} por rol + {solosElegidos} elegidas)
                </span>
              ) : null}
            </p>
            {preview.total > 0 ? (
              <ul aria-label="Quiénes lo recibirán" className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border text-sm">
                {preview.destinatarios.map((d) => (
                  <li key={d.usuarioId} className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
                    <span>
                      {d.nombre} <span className="text-muted-foreground">({etiquetaRol(d.rol)})</span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{d.telefonoEnmascarado}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {preview.excedeTope ? (
              <p role="alert" className="mt-2 text-sm text-danger-strong">
                Son más de {preview.tope} personas: así no se puede guardar. Elige menos roles o personas.
              </p>
            ) : null}
          </>
        )}
      </div>

      {sinTelefono.length > 0 || compartidos.length > 0 ? (
        <div role="status" className="rounded-lg border border-warning/60 bg-warning-soft p-3 text-warning-strong">
          {sinTelefono.length > 0 ? (
            <>
              <p className="text-sm font-semibold">
                {sinTelefono.length === 1
                  ? "1 persona no lo va a recibir: su teléfono no sirve para WhatsApp"
                  : `${sinTelefono.length} personas no lo van a recibir: su teléfono no sirve para WhatsApp`}
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed">
                {sinTelefono.map((d) => (
                  <li key={d.usuarioId}>
                    <strong>{d.nombre}</strong> ({etiquetaRol(d.rol)})
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {compartidos.length > 0 ? (
            <>
              <p className="mt-1 text-sm font-semibold">Estas personas comparten teléfono: ese número recibirá un mensaje por cada una</p>
              <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed">
                {compartidos.map((d) => (
                  <li key={d.usuarioId}>
                    <strong>{d.nombre}</strong> ({etiquetaRol(d.rol)}) — {d.telefonoEnmascarado}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-2 text-xs">
            Se puede guardar igual. Corrígelo en{" "}
            <Link href="/configuracion" className="font-semibold underline underline-offset-2">
              Usuarios
            </Link>{" "}
            y lo recibirán desde el siguiente envío.
          </p>
        </div>
      ) : null}

      {errores && errores.length > 0 ? <FieldError id="destinatarios-error" messages={errores} /> : null}
    </div>
  );
}
