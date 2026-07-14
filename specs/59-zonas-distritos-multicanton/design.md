# Feature 59 — Design (frontend puro)

> Decisiones técnicas de la mejora de UX del selector de distritos del `ZonaForm`.
> Asume la ruta RECOMENDADA de F1.4. Solo frontend: se reestructura la sección
> "Distritos de la zona" de `app/(app)/configuracion/_components/ZonaForm.tsx`. **No** se
> tocan backend, migraciones, RLS, ni el contrato de `crearZona`/`actualizarZona`.

## Archivos y símbolos reales afectados

- **A editar:** `app/(app)/configuracion/_components/ZonaForm.tsx`
  - Estado `selected` (hoy `Record<string, string>`), `toggleDistrito`, `seedSeleccionEdicion`,
    `selectedIds`, `buildCandidate`, el `fieldset` "Distritos de la zona" (líneas ~375-459) y el
    `<p data-testid="distritos-seleccionados">`.
- **A editar (tests):** `tests/unit/components/zona-form.test.tsx` (nuevos casos R1..R11; ajustar
  el mock de `@/lib/actions/zonas` si se adopta F1.4-e recomendado — añadir `arbolZonas`).
- **Reuso sin cambios:** `lib/actions/geo.ts` (`listarProvincias`, `listarCantones`,
  `listarDistritos`), `lib/actions/zonas.ts` (`crearZona`, `actualizarZona`, y `arbolZonas` como
  LECTURA), `lib/types/zona.ts` (DTOs), `components/ui/*` (`Button`, `Label`, `Select`, `Input`,
  `Switch`), `ZonasModule.tsx` (no cambia: sigue montando `<ZonaForm mode zona centralActual/>`).

## Modelo de estado (refactor mínimo del `selected`)

El corazón del cambio: `selected` deja de ser `distritoId → nombre` y pasa a guardar el contexto
geográfico de cada distrito, de modo que el resumen se pueda **derivar** de una sola fuente de
verdad (F1.4-c).

```ts
// tipo INTERNO de UI (no cruza la frontera cliente↔servidor; no va en lib/types/zona.ts)
interface DistritoSeleccionado {
  distritoNombre: string;
  cantonId: string;
  cantonNombre: string;
  provinciaId: string | null;   // null cuando aún no se conoce (pre-carga edición, F1.4-e)
  provinciaNombre: string | null;
}
const [selected, setSelected] = useState<Record<string, DistritoSeleccionado>>({});
```

- `toggleDistrito(distrito: DistritoCatalogoDTO)` captura al vuelo el contexto actual:
  `provinciaId` + label desde `provinciaOptions`, `cantonId` + label desde `cantonOptions`,
  `distrito.nombre`. Agrega/quita del mapa. (En selección por navegación la provincia SIEMPRE se
  conoce.)
- `removeDistrito(distritoId)`: nueva función; borra la key del mapa. La usa el botón "quitar" del
  resumen (R5) y comparte estado con los checkboxes (R6).
- `selectedIds = Object.keys(selected)` — **igual que hoy**. `buildCandidate()` sigue enviando
  `distritoIds: selectedIds` → contrato INTACTO (R10). El schema (`distritoIds.min(1)`) no cambia.
- Contador (R7): `Object.keys(selected).length`, mismo `<p data-testid="distritos-seleccionados">`.

### Enriquecimiento perezoso de provincia (soporta F1.4-e)
Cuando un distrito se pre-cargó sin provincia (`provinciaId: null`, vía `arbolZonas`) y luego el
maestro navega la provincia/cantón que lo contiene, `seedSeleccionEdicion`/`toggleDistrito`
rellenan `provinciaId/provinciaNombre` para ese id (merge no destructivo). Así el grupo del resumen
migra de "por cantón" a "por provincia→cantón" sin perder la selección.

## Reestructura de la sección "Distritos de la zona"

Orden vertical dentro del `fieldset` (legend "Distritos de la zona"):

1. **Navegador** (sin cambios funcionales): `Select` Provincia → `Select` Cantón → grupo de
   checkboxes del cantón abierto (`role="group" aria-label="Distritos disponibles"`).
   - Checkbox: `checked = d.id in selected` (fuente de verdad = `selected`, R6).
   - `disabled = enOtraZona` con `enOtraZona = d.zonaId !== null && (!zona || d.zonaId !== zona.id)`
     (R8, sin cambios). `onChange = () => toggleDistrito(d)`.
2. **Resumen** (NUEVO): lista agrupada de TODOS los `selected`, visible siempre que haya ≥1
   (independiente del cantón abierto, R3). Estructura (F1.4-a):

```
Resumen (contenedor: role="group" aria-label="Distritos seleccionados de la zona",
         data-testid="resumen-distritos", flex-col, overflow controlado)
  └─ por PROVINCIA (encabezado; los de provincia desconocida caen bajo su cantón — F1.4-e)
       └─ por CANTÓN (encabezado)
            └─ fila DISTRITO: <span>{nombre}</span>
                              <Button variant="ghost" size="sm"
                                      aria-label={`Quitar ${nombre}`}
                                      onClick={() => removeDistrito(id)}>Quitar</Button>
```

   - Derivación: `useMemo` que agrupa `Object.entries(selected)` por `provinciaId` (o `cantonId`
     si la provincia es null) → `cantonId`, ordenando por nombre. Sin estado extra (R6).
   - Vacío: cuando no hay seleccionados, no se renderiza el resumen (el contador ya dice
     "Sin distritos seleccionados").
3. **Contador** existente `data-testid="distritos-seleccionados"` (R7) + errores `distritoIds` (R12).

### Sincronización bidireccional (R6)
Un único `selected`. Los checkboxes y el resumen lo LEEN; `toggleDistrito` y `removeDistrito` lo
ESCRIBEN. Consecuencias automáticas: quitar desde el resumen un distrito del cantón abierto ⇒ su
checkbox (que lee `d.id in selected`) se desmarca; (des)marcar un checkbox ⇒ el resumen (derivado)
se recomputa. No hay efectos de espejo.

## Pre-carga en edición (F1.4-e, recomendado)

- Al montar en `mode="editar"`, un SWR de solo-lectura sobre `arbolZonas()`
  (key `["zonas:arbol", zona.id]`), gate maestro ya incorporado en la acción.
- Del resultado `ArbolZonas` se localiza el nodo de la zona por `zona.id` (o nombre normalizado) y
  se siembra `selected` con `{ distritoId, distritoNombre, cantonId, cantonNombre,
  provinciaId: null, provinciaNombre: null }` para TODOS sus cantones/distritos (R9), en un
  `setSelected` idempotente (merge, no pisa lo ya presente / enriquecido).
- `seedSeleccionEdicion` (onSuccess de `listarDistritos`) se mantiene: al navegar cada cantón,
  confirma/actualiza los distritos de ESTA zona y **enriquece la provincia** de los pre-cargados.
- Caveat documentado (deuda feature-24): una zona SEMBRADA por script puede no aparecer en el N:M y
  por tanto no pre-marcarse; se respeta, no se corrige aquí.

## Contratos I/O (sin cambios)

- Entrada de las acciones geo: `listarCantones(provinciaId: string)`,
  `listarDistritos(cantonId: string)` → `{ status:"ok", items: DistritoCatalogoDTO[] } | error`.
- Salida hacia backend: `crearZona(input)` / `actualizarZona(id, input)` con
  `input.distritoIds: string[]` (**set completo**, `min(1)`), `tarifas`, `nombre`, `cobroVehiculo`,
  `esCentral`. **Idéntico a hoy** (R10, R12).
- `arbolZonas()` (solo lectura, sin params) → `{ status:"ok", arbol: ArbolZonas } | error`.

## Accesibilidad / responsive (R11, F1.4-f)

- Encabezados de grupo con jerarquía semántica y `aria-label` por provincia/cantón; botón "quitar"
  con `aria-label="Quitar <distrito>"` (localizable en tests por nombre accesible).
- Contenedor del resumen con `flex flex-col gap-*` y `overflow`/`flex-wrap` para no desbordar dentro
  del `Modal className="max-w-lg"` en móvil. Reuso de `Button`/`Label` de `components/ui`.

## `data-testid` / contratos que se CONSERVAN

- `data-testid="distritos-seleccionados"` (contador) — intacto (R7).
- aria-labels existentes: "Provincia", "Cantón", checkbox por nombre de distrito, "Marcar como zona
  central", "Cobra por tipo de vehículo", tarifas — intactos (R12).
- `ZonaFormHandle.submit()`, `ZonaFormProps` (`mode`, `zona`, `centralActual`) — intactos.
- Payload de `crearZona`/`actualizarZona` — intacto.
- **Nuevos** (aditivos, no rompen nada): `data-testid="resumen-distritos"` y botones
  `aria-label="Quitar <distrito>"`.

## Alternativas consideradas y descartadas

1. **(Descartada) Extender `ZonaDTO`/`obtenerZona` con los distritos+provincia+cantón asignados.**
   Daría agrupación provincia→cantón perfecta desde el inicio en edición (R9), pero es un cambio de
   **backend/contrato** → viola el alcance "frontend puro". Por eso se elige `arbolZonas` (lectura
   existente) + enriquecimiento perezoso de provincia. (F1.4-e.)
2. **(Descartada) Doble estado checkboxes/resumen sincronizado por `useEffect`.** Duplica la fuente
   de verdad e invita a desincronización; se elige un único `selected` derivado (F1.4-c).
3. **(Descartada) Renderizar TODOS los checkboxes de todos los cantones a la vez** (en vez de un
   resumen). Inviable: CR tiene ~490 distritos en ~80 cantones; cargarlos todos es pesado y rompe la
   navegación provincia→cantón existente. El resumen deriva solo de lo seleccionado.
4. **(Descartada) Chips planos en vez de lista agrupada.** Compacto pero pierde el origen
   provincia/cantón y confunde con distritos homónimos (F1.4-a).
5. **(Descartada) Mantener `selected` como `Record<id, nombre>` y guardar la geografía en un mapa
   aparte.** Añade un segundo estado a mantener en sync; se prefiere enriquecer el propio `selected`.
