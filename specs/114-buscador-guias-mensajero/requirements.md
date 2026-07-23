# Feature 114 — Mensajero: buscador de guías asignadas — requirements

> Zona: frontend · Complejidad: low · Rama: `feature/114-buscador-guias-mensajero`
> depends_on: 36 (done). Frontend 100% en cliente, **sin backend**: no hay tabla,
> migración, endpoint ni Server Action nueva. El filtrado es puro sobre datos ya
> presentes en `MiAsignacionDTO`, entregados por props al módulo.

## Contexto verificado en el código (fuente de verdad)

- `MisAsignacionesModule` — `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`.
  Componente cliente (`"use client"`) que recibe por props los dos grupos ya
  resueltos: `porRecoger` y `porGestionar` (`MiAsignacionDTO[]`).
- Grupo "Por recoger": se renderiza vía `PorAceptarSection`
  (`app/(app)/_components/PorAceptarSection.tsx`) con `ordenes={porRecoger}`
  (`MisAsignacionesModule.tsx:214`).
- Grupo "En reparto / por gestionar": se renderiza como grilla de cards con
  `porGestionar.map(...)` (`MisAsignacionesModule.tsx:296`).
- DTO `MiAsignacionDTO` — `lib/interfaces/services/IMisAsignacionesService.ts:12`.
  Campos requeridos, TODOS ya presentes:
  - `numGuia: number | null` (`:14`)
  - `numRemision: string` (`:15`)
  - `destinatario: string` (`:16`)
- Normalizador reutilizable ya existente: `normalizeName` en
  `lib/utils/normalize.ts:7` (NFD + elimina diacríticos + `toLowerCase` + `trim` +
  colapsa espacios). Es la base de la coincidencia insensible a mayúsculas/acentos.
- Primitiva de UI para el input: `components/ui/input.tsx` (shadcn/ui, ya en el repo,
  usada por `InputRecoger`).

## Requisitos (EARS)

**R1 (Ubicuo).** El sistema DEBE mostrar, dentro de `MisAsignacionesModule` y por
encima de ambos grupos ("Por recoger" y "En reparto / por gestionar"), un campo de
búsqueda de guías visible y con etiqueta accesible.

**R2 (Por evento).** CUANDO el mensajero escribe texto en el campo de búsqueda, el
sistema DEBE filtrar las guías mostradas en AMBOS grupos, conservando solo aquellas
cuyo `numGuia`, `numRemision` o `destinatario` contengan el texto buscado.

**R3 (Ubicuo).** El sistema DEBE tratar la coincidencia como PARCIAL (subcadena) e
INSENSIBLE a mayúsculas/minúsculas y a acentos/diacríticos (normalización aplicada
por igual al texto buscado y a los campos comparados). Ejemplos: `perez` coincide
con `Pérez`; `rem-0` coincide con `REM-001`.

**R4 (Condicional).** SI el `numGuia` de una guía es `null`, ENTONCES el sistema DEBE
no producir coincidencia por ese campo (se compara como texto vacío), SIN impedir la
coincidencia por `numRemision` o `destinatario`. El `numGuia` numérico se compara como
texto (ej.: buscar `10` coincide con `numGuia` `1001`).

**R5 (De estado).** MIENTRAS el texto buscado esté vacío o contenga solo espacios en
blanco, el sistema DEBE mostrar TODAS las guías de ambos grupos, sin filtrar,
idéntico al comportamiento actual sin búsqueda.

**R6 (Condicional).** SI hay texto buscado no vacío y un grupo no tiene ninguna guía
coincidente, ENTONCES el sistema DEBE mostrar en ese grupo un mensaje de "sin
resultados" (que contenga la frase «coincide con la búsqueda»), DISTINGUIBLE del
mensaje de grupo vacío sin búsqueda.

**R7 (Ubicuo).** El sistema DEBE aplicar el filtro de forma INDEPENDIENTE por grupo:
una guía se evalúa y se muestra dentro de su propio grupo ("Por recoger" o "En
reparto"), sin mezclar grupos.

**R8 (Ubicuo).** El sistema DEBE mantener COHERENTE el conjunto filtrado entre la
lista, el mapa de ruta y el panel de detalle: el mapa (`paradasMapa`) y la orden del
panel de detalle (`detalleOrden`) DEBEN derivarse de la lista FILTRADA por la
búsqueda (unificado con la feature 117). La búsqueda NO DEBE alterar el puntero de
bloqueo de gestión (`ordenEnGestionId`) ni los KPIs. Verificable: con un texto que
excluye una parada de la lista, esa parada tampoco se envía al mapa de ruta.

**R9 (De estado / salvaguarda).** MIENTRAS haya una orden en gestión
(`ordenEnGestionId !== null`), el sistema DEBE mantener esa orden VISIBLE en la lista
de "En reparto" y en el mapa aunque no coincida con el texto buscado, para no ocultar
la gestión en curso. Verificable: con `ordenEnGestionId` fijado y un texto que no
coincide con esa orden, la card y su parada siguen presentes.

## Trazabilidad sugerida (R → test)

| Req | Test (nombre y archivo) |
| --- | --- |
| R1 | "R1: renderiza un campo de búsqueda de guías visible sobre ambos grupos" — `tests/components/MisAsignacionesModule.test.tsx` |
| R2 | "R2: escribir texto filtra ambos grupos por numGuia/numRemision/destinatario" — `tests/components/MisAsignacionesModule.test.tsx` |
| R3 | "R3: coincidencia parcial insensible a mayúsculas y acentos" — `tests/unit/components/mis-asignaciones-buscador.test.ts` |
| R4 | "R4: numGuia null no coincide por guía; numérico coincide como texto" — `tests/unit/components/mis-asignaciones-buscador.test.ts` |
| R5 | "R5: query vacía o solo-espacios muestra todas las guías" — `tests/unit/components/mis-asignaciones-buscador.test.ts` + component test |
| R6 | "R6: sin coincidencias muestra 'sin resultados' distinguible del vacío" — `tests/components/MisAsignacionesModule.test.tsx` |
| R7 | "R7: el filtro aplica por grupo de forma independiente" — `tests/components/MisAsignacionesModule.test.tsx` |
| R8 | "R8: filtrar excluye la parada de la lista Y del mapa de ruta" — `tests/components/MisAsignacionesModule.test.tsx` |
| R9 | "R9: la orden en gestión permanece en lista/mapa aunque no coincida con la búsqueda" — `tests/components/MisAsignacionesModule.test.tsx` |

## Preguntas abiertas

Ninguna bloquea la implementación. Se listan decisiones de bajo riesgo tomadas con
un default explícito (ver `design.md §Decisiones`); cámbialas si el humano indica lo
contrario:

1. **Visibilidad con mensajero BLOQUEADO (feature 111).** ¿El buscador permanece
   visible cuando `bloqueado === true`? Default asumido: **sí** (es un filtro puro de
   cliente, inofensivo; la lista "Por recoger" sigue visible como solo-visualización y
   las cards de "En reparto" siguen visibles aunque deshabilitadas).
2. **Contador del banner de "Por recoger".** El banner "N Órdenes nuevas asignadas"
   de `PorAceptarSection` deriva de `ordenes.length`. Con búsqueda activa, ¿debe
   mostrar el conteo FILTRADO o el TOTAL? Default asumido: **filtrado** (se pasa la
   lista ya filtrada al componente compartido sin modificarlo).
3. **Un input o uno por grupo.** ¿Un único campo filtra ambos grupos, o uno por
   grupo? Default asumido: **uno solo** (la descripción dice "Input de búsqueda" en
   singular).
