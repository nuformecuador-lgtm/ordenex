# Feature 59 — Zonas: seleccionar distritos de VARIOS cantones

> Spec en notación EARS. Aquí va el QUÉ, sin detalles de implementación (esos van en
> `design.md`). Feature **FRONTEND PURO** (mejora de UX del `ZonaForm`). Depende de la
> feature 55 (ZonaForm reconstruido).

## Contexto verificado en código (baseline `feature/59-zonas-distritos-multicanton`)

Estudiado el código real antes de escribir (no se inventa nada):

- **Componente:** `app/(app)/configuracion/_components/ZonaForm.tsx`
  (`ZonaForm` = `forwardRef<ZonaFormHandle, ZonaFormProps>`; `submit()` imperativo
  disparado por el `Modal` de `ZonasModule`).
- **Estado de selección:** `const [selected, setSelected] = useState<Record<string, string>>({})`
  = mapa `distritoId → distritoNombre`. `toggleDistrito(id, nombre)` agrega/quita del mapa.
  **La selección YA se ACUMULA** al cambiar de cantón: `setCantonId` NO resetea `selected`;
  solo cambia la key SWR `["zonas:distritos", cantonId]`. El problema NO es que se pierda la
  selección, es que **la UI solo pinta los checkboxes del cantón actual** (`cantonId ? … : null`,
  líneas 404-443), así que los distritos elegidos de OTROS cantones no se ven ni se pueden quitar.
- **Navegación del catálogo global:** `provinciaId` / `cantonId` (estado local) alimentan SWR:
  - `listarProvincias()` (key `"zonas:provincias"`)
  - `listarCantones(provinciaId)` (key `["zonas:cantones", provinciaId]`)
  - `listarDistritos(cantonId)` (key `["zonas:distritos", cantonId]`, con
    `onSuccess: seedSeleccionEdicion`)
  Todas de `@/lib/actions/geo` (`lib/actions/geo.ts`), gate maestro, ya existentes (feature 55).
- **DTOs (de `lib/types/zona.ts`):** `DistritoCatalogoDTO { id, nombre, zonaId, zonaNombre }`,
  `CantonLightDTO { id, nombre }`, `ProvinciaLightDTO { id, nombre }`.
- **R10 (feature 55) — distritos de OTRA zona:** cada checkbox calcula
  `enOtraZona = d.zonaId !== null && (!zona || d.zonaId !== zona.id)` y se deshabilita, mostrando
  `(asignado a <zonaNombre>)`.
- **Pre-marcado en edición:** `seedSeleccionEdicion(items)` (líneas 162-175) marca en `selected`
  los `d` con `d.zonaId === zona.id`, PERO solo corre en el `onSuccess` del cantón que se está
  cargando → **en edición solo se pre-marcan los distritos del cantón navegado, no los de otros
  cantones**.
- **Contador existente:** `<p data-testid="distritos-seleccionados">` (líneas 445-452) muestra
  `Distritos seleccionados: N` (o "Sin distritos seleccionados"), con `N = Object.keys(selected).length`.
- **Contrato de envío (INTACTO):** `buildCandidate()` (líneas 244-261) envía
  `distritoIds: selectedIds` (`Object.keys(selected)`) — el conjunto **COMPLETO**, venga de
  los cantones que venga — a `crearZona(input)` / `actualizarZona(zona.id, input)`
  (`lib/actions/zonas.ts`). El schema `crearZonaSchema` exige `distritoIds.min(1)`. **No se toca.**
- **Fuente de datos en edición:** `ZonasModule.abrirEditar` llama `obtenerZona(row.id)` →
  `ObtenerZonaResult` → `ZonaDTO`. **`ZonaDTO` NO incluye la lista de distritos con su
  provincia/cantón; solo `distritosCount: number`.** (Relevante para R9 / F1.4-e.)
- **Divergencia conocida escalar↔N:M (deuda nivel feature-24, documentada en el header del
  propio `ZonaForm`):** el seed asigna por `distrito.zonaId` (escalar) y `listarDistritos` lee del
  N:M `ZonaDistrito`; una zona SEMBRADA (no creada por el CRUD) puede no pre-marcar sus distritos.
  Esta feature NO la resuelve; solo la respeta.
- **Tests existentes a preservar:** `tests/unit/components/zona-form.test.tsx` (usa
  `data-testid="distritos-seleccionados"` implícitamente vía el flujo, los aria-labels de
  provincia/cantón/distrito, y `input.distritoIds`).

## Convenciones EARS
Ubicuo: "El sistema DEBE…". Evento: "CUANDO … el sistema DEBE…". Estado: "MIENTRAS …".
Condicional: "SI … ENTONCES el sistema DEBE…". Opcional: "DONDE …".

---

## Requisitos

### Selección cruzada (multi-cantón)

**R1 (Estado).** MIENTRAS el maestro compone los distritos de una zona, CUANDO cambia el
cantón o la provincia seleccionados en el navegador, el sistema DEBE conservar íntegro el
conjunto de distritos ya seleccionados de los cantones anteriores (no se descartan).
(Testeable: seleccionar distritos en el cantón A, cambiar al cantón B, volver a A → los de A
siguen marcados; el total no baja.)

**R2 (Evento).** CUANDO el maestro marca un distrito de un cantón distinto a aquel donde ya
tenía distritos seleccionados —incluso de otra provincia—, el sistema DEBE agregarlo al
conjunto de seleccionados SIN quitar ninguno de los previos. (Testeable: marcar distrito de
cantón A y luego de cantón B → el conjunto contiene ambos.)

### Resumen visible de la selección

**R3 (Ubicuo).** El sistema DEBE mostrar, en la sección "Distritos de la zona", un resumen
visible con TODOS los distritos actualmente seleccionados de la zona (de todos los cantones y
provincias), independientemente del cantón que esté abierto en el navegador. (Testeable: con
distritos seleccionados de 2 cantones, el resumen lista los distritos de ambos aunque solo uno
esté abierto.)

**R4 (Ubicuo).** El resumen DEBE presentar los distritos seleccionados AGRUPADOS por
provincia y cantón (jerárquicamente), de modo que cada distrito aparezca bajo el encabezado de
su cantón (y su provincia). (Testeable: el resumen contiene encabezados de provincia/cantón y,
bajo ellos, los nombres de sus distritos seleccionados.) [Forma sujeta a **F1.4-a**.]

**R5 (Evento).** CUANDO el maestro activa el control "quitar" de un distrito dentro del
resumen, el sistema DEBE removerlo del conjunto de seleccionados y actualizar el resumen y el
contador. (Testeable: quitar un distrito desde el resumen → deja de listarse y el total baja en 1.)

**R6 (Condicional — sincronización bidireccional).** SI el distrito que el maestro quita desde
el resumen pertenece al cantón que está abierto en el navegador, ENTONCES el sistema DEBE
reflejar el cambio desmarcando su checkbox; e inversamente, marcar o desmarcar un checkbox del
cantón abierto DEBE reflejarse de inmediato en el resumen. El estado de selección DEBE ser una
única fuente de verdad compartida entre checkboxes y resumen. (Testeable: quitar desde el
resumen un distrito del cantón abierto → su checkbox queda desmarcado; desmarcar un checkbox →
desaparece del resumen.) [Ver **F1.4-c**.]

### Contador y compatibilidad

**R7 (Ubicuo).** El sistema DEBE conservar el contador existente
`data-testid="distritos-seleccionados"` mostrando el total de distritos seleccionados de TODOS
los cantones, junto al nuevo resumen. (Testeable: el elemento con ese `data-testid` sigue
existiendo y su número coincide con el tamaño del conjunto completo.) [Ver **F1.4-b**.]

### Reglas de asignación (R10 heredada)

**R8 (Estado).** MIENTRAS el maestro compone los distritos, el sistema DEBE seguir mostrando
como NO seleccionables (deshabilitados, con su zona indicada) los distritos ya asignados a OTRA
zona; y el resumen NO DEBE listar distritos que no sean seleccionables por esta zona (solo lista
los que están efectivamente en el conjunto de ESTA zona). (Testeable: un distrito con `zonaId`
de otra zona no puede agregarse y nunca aparece en el resumen.) [Ver **F1.4-d**.]

### Edición multi-cantón

**R9 (Estado — edición).** MIENTRAS el maestro edita una zona cuyos distritos abarcan varios
cantones, el sistema DEBE mostrar en el resumen TODOS los distritos pre-asignados a esa zona
desde el inicio de la sesión de edición, no solo los del primer cantón que navegue. (Testeable:
abrir en modo editar una zona con distritos en ≥2 cantones → el resumen los lista todos antes de
navegar cada cantón.) [Mecanismo de carga sujeto a **F1.4-e**.]

### Contrato de envío (INTACTO)

**R10 (Evento).** CUANDO el maestro guarda la zona, el sistema DEBE enviar a `crearZona` /
`actualizarZona` el conjunto COMPLETO de `distritoIds` seleccionados (de todos los cantones),
usando exactamente el contrato actual (`distritoIds: string[]`, `min(1)`), sin cambiar el
payload ni la firma de esas acciones. (Testeable: seleccionar distritos de 2 cantones y enviar →
`input.distritoIds` contiene los ids de ambos cantones; no cambia la forma del payload.)

### Accesibilidad y responsive

**R11 (Ubicuo).** El resumen DEBE ser accesible: encabezados/etiquetas legibles para los grupos
provincia/cantón, y cada control "quitar" DEBE tener un nombre accesible que identifique al
distrito; el bloque NO DEBE desbordar horizontalmente en viewport móvil (el contenido hace wrap
/ scroll contenido, no rompe el layout del modal). (Testeable: los botones "quitar" son
localizables por nombre accesible por distrito; el contenedor usa clases de wrap/overflow
controladas.) [Ver **F1.4-f**.]

### No regresión

**R12 (Ubicuo).** El sistema DEBE preservar sin cambios el resto del comportamiento y los
contratos del `ZonaForm`: validación con `crearZonaSchema`, errores por campo (R11 feature 55),
editor de tarifas condicionado por `cobroVehiculo`, toggle `esCentral` y su confirmación de
reasignación, prefill de escalares en edición, y todos los `data-testid`/`aria-label` que hoy
consumen los tests. (Testeable: la suite existente `tests/unit/components/zona-form.test.tsx`
sigue verde sin cambios de contrato.)

---

## Fuera de alcance (explícito)

- **Backend, migraciones, RLS y contratos de zonas.** NO se modifican `crearZona`/
  `actualizarZona` ni su payload; el envío sigue siendo el **set completo de `distritoIds`**
  (N:M `ZonaDistrito`), lógica que YA existe y NO se toca.
- **Acciones geo:** se REUSAN `listarProvincias`/`listarCantones`/`listarDistritos` tal cual
  (lectura); no se crean ni modifican Server Actions de zonas/geo. (La única excepción posible,
  el consumo de LECTURA de `arbolZonas()`, se debate en **F1.4-e**; no implica modificar backend.)
- **Divergencia escalar↔N:M de zonas sembradas** (deuda nivel feature-24): fuera de alcance;
  solo se respeta y documenta.
- **Modelo de datos / DTOs de dominio:** no se cambian tipos de `lib/types/zona.ts` que crucen la
  frontera cliente↔servidor. (Un tipo interno de UI para el resumen es admisible; ver `design.md`.)

---

## Trazabilidad R → test previsto

| R | Test previsto (archivo::caso) | Tipo |
|---|---|---|
| R1 | `tests/unit/components/zona-form.test.tsx` :: selección en cantón A se conserva al cambiar a B y volver | component |
| R2 | `zona-form.test.tsx` :: marcar distritos de 2 cantones (misma/distinta provincia) → conjunto contiene ambos | component |
| R3 | `zona-form.test.tsx` :: el resumen lista distritos de 2 cantones aunque solo uno esté abierto | component |
| R4 | `zona-form.test.tsx` :: el resumen agrupa por provincia/cantón (encabezados + distritos bajo su grupo) | component |
| R5 | `zona-form.test.tsx` :: "quitar" desde el resumen elimina el distrito y baja el total | component |
| R6 | `zona-form.test.tsx` :: quitar desde el resumen un distrito del cantón abierto desmarca su checkbox; y desmarcar checkbox lo saca del resumen | component |
| R7 | `zona-form.test.tsx` :: `data-testid="distritos-seleccionados"` existe y su número = tamaño del conjunto completo | component |
| R8 | `zona-form.test.tsx` :: distrito de otra zona sigue deshabilitado y nunca aparece en el resumen | component |
| R9 | `zona-form.test.tsx` :: en `mode="editar"` con distritos en ≥2 cantones, el resumen los lista todos desde el inicio | component |
| R10 | `zona-form.test.tsx` :: enviar con distritos de 2 cantones → `input.distritoIds` incluye los de ambos (set completo) | component |
| R11 | `zona-form.test.tsx` :: botones "quitar" localizables por nombre accesible por distrito; contenedor con clases de wrap/overflow | component |
| R12 | `zona-form.test.tsx` (suite existente completa) :: sin cambios de contrato; verde | component |

> El mapa definitivo R→test lo consolida el implementer en `progress/impl_59-…md` y lo verifica
> el reviewer (regla #4). Un R sin test es un fallo de la feature.

---

## Preguntas abiertas (F1.4) — requieren decisión humana antes de implementar

Cada una lleva **recomendación** + **alternativa**. NO están cerradas.

### F1.4-a — Forma del resumen de selección cruzada (afecta R3, R4)
- **Recomendación:** *Lista agrupada provincia → cantón* con un botón "quitar" por distrito.
  Estructura visible: encabezado de **provincia**; dentro, encabezado de **cantón**; dentro, una
  fila por **distrito** (nombre + botón "quitar"). Justificación: refleja la misma jerarquía que
  el navegador (provincia→cantón→distrito), escala a decenas de distritos y hace obvio de dónde
  viene cada uno. Nota de dependencia con F1.4-e: la provincia de un distrito **pre-cargado en
  edición** puede no conocerse de entrada (ver F1.4-e); en ese caso el grupo se ancla por
  **cantón** y la provincia se completa al navegarla. Si esto no se desea, la variante robusta es
  **agrupar por cantón** (encabezado de cantón, provincia como etiqueta secundaria cuando se
  conozca).
- **Alternativa (descartable):** *Chips/tags planos* (un chip por distrito con "x"). Más compacto,
  pero pierde la agrupación y confunde al haber distritos homónimos en cantones distintos.

### F1.4-b — Contador existente `distritos-seleccionados` (afecta R7)
- **Recomendación:** *Conservarlo* junto al nuevo resumen. No romper el test/`data-testid`
  existente y dar un total rápido a la vista. El resumen y el contador leen el MISMO conjunto.
- **Alternativa (descartable):** *Reemplazarlo* por el resumen (el total se infiere del resumen).
  Rechazada: rompería el `data-testid="distritos-seleccionados"` que ya consume la suite y quita
  un total glanceable.

### F1.4-c — Sincronización resumen ↔ checkboxes del cantón abierto (afecta R6)
- **Recomendación:** *Fuente de verdad única* = el estado `selected`. Los checkboxes derivan su
  `checked` de `selected` y el resumen se deriva de `selected`; quitar desde el resumen o
  (des)marcar un checkbox mutan el MISMO estado, por lo que la sincronización es automática y
  bidireccional sin lógica de espejo. (Es una evolución directa del `selected` actual.)
- **Alternativa (descartable):** mantener dos estados (checkboxes vs. resumen) y sincronizarlos por
  efectos. Rechazada: duplica estado, invita a desincronización y re-renders innecesarios.

### F1.4-d — R10 en el resumen: distritos de OTRA zona (afecta R8)
- **Recomendación:** los distritos deshabilitados por pertenecer a OTRA zona **no son agregables**
  (checkbox `disabled`, como hoy) y por tanto **nunca entran a `selected`** ni aparecen en el
  resumen. El resumen lista EXCLUSIVAMENTE los distritos seleccionables/seleccionados de ESTA
  zona. No se añade indicador de "bloqueado" en el resumen (no llegan ahí).
- **Alternativa (descartable):** listar en el resumen también los de otra zona en estado
  informativo/bloqueado. Rechazada: ruido visual y contradice que el resumen refleja el conjunto
  enviable (`distritoIds`).

### F1.4-e — Pre-marcado multi-cantón en edición: fuente de datos (afecta R9)
> Es un **requisito confirmado** (R9). Lo abierto es CÓMO obtener, frontend-only, todos los
> distritos pre-asignados de la zona con su geografía, dado que **`ZonaDTO`/`obtenerZona` NO los
> traen** (solo `distritosCount`) y `seedSeleccionEdicion` solo marca el cantón navegado.
- **Recomendación:** *Pre-cargar vía la LECTURA existente `arbolZonas()`* (`lib/actions/zonas.ts`,
  ya expuesta, gate maestro). Devuelve el árbol zona→cantón→distrito de distritos YA asignados; se
  localiza el nodo de la zona en edición (por su `id`/nombre normalizado) y se siembra `selected`
  con `{ distritoId, distritoNombre, cantonId, cantonNombre }` de TODOS sus cantones al montar el
  formulario en modo editar. Es **frontend puro** (consumo de una acción de lectura ya existente;
  no se modifica backend). Caveat: el árbol NO incluye **provincia**, así que esos distritos se
  agrupan por **cantón** hasta que el maestro navegue su provincia (entonces se enriquece la
  provincia); y requiere añadir `arbolZonas` al mock de zonas en el test existente (ajuste de
  test, no de contrato).
- **Alternativa (descartada — NO frontend puro):** extender `obtenerZona`/`ZonaDTO` para incluir
  los distritos asignados con provincia+cantón. Daría agrupación provincia→cantón perfecta desde el
  inicio, pero es un **cambio de backend/contrato** → fuera de alcance de esta feature.
- **Fallback (descartable):** mantener el pre-marcado perezoso actual (solo el cantón navegado).
  Rechazado: incumple R9 ("todos desde el inicio").

### F1.4-f — Accesibilidad/responsive del bloque de resumen (afecta R11)
- **Recomendación:** encabezados de grupo con jerarquía semántica (p. ej. texto con rol de
  encabezado o `role="group"` + `aria-label` por cantón/provincia); botón "quitar" por distrito con
  `aria-label="Quitar <distrito>"`; contenedor con `flex-wrap`/`overflow` controlado y ancho máximo
  al del modal (`max-w-lg`), de modo que en móvil el contenido haga wrap o scroll interno sin romper
  el layout. Reusar primitivas existentes (`Button variant="ghost"`, `Label`).
- **Alternativa (descartable):** resumen en tabla/grid fija. Rechazada: peor en móvil (scroll
  horizontal) y mayor complejidad para un bloque simple.
