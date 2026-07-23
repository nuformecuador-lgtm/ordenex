# Feature 117 — Filtro de órdenes por cantón y distrito (mensajero)

> Requisitos en notación EARS. Sin detalles de implementación (esos van en `design.md`).
> Cada `R<n>` debe poder verificarse con un test.

## Contexto (hechos verificados en el código, no supuestos)

- El portal del mensajero se renderiza en `MisAsignacionesModule`
  (`app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx:62`), que recibe
  por props DOS grupos de órdenes ya resueltos server-side:
  `porRecoger: MiAsignacionDTO[]` y `porGestionar: MiAsignacionDTO[]`
  (`MisAsignacionesModule.tsx:41-45`).
- `MiAsignacionDTO` ya incluye `cantonNombre: string` y `distritoNombre: string | null`
  (`lib/interfaces/services/IMisAsignacionesService.ts:30-31`), poblados en
  `MisAsignacionesService.toDTO` (`lib/services/MisAsignacionesService.ts:407-408`).
  Por tanto **no se requiere backend**: opciones y filtrado se derivan en cliente de
  los DTOs ya cargados.
- Existe una primitiva `Select` reutilizable de base-ui
  (`components/ui/select.tsx`): rol accesible `combobox`, `value` string
  (`""` = sin selección), `onValueChange`, `options: SelectOption[]`.
- Existe `normalizeName` (`lib/utils/normalize.ts:7`) para comparar nombres
  insensible a mayúsculas/acentos y espacios sobrantes (reutilizable para deduplicar).

## Requisitos

**R1 (Ubicuo).** El sistema DEBE mostrar, dentro de `MisAsignacionesModule` y **solo
ahí**, un control de filtro compuesto por dos selects: uno de **Cantón** y otro de
**Distrito**. Ninguna otra lista de órdenes de la aplicación (maestro/admin/tienda)
se ve afectada por esta feature (alcance: solo la lista del mensajero).

**R2 (Ubicuo).** El sistema DEBE derivar las opciones del select de **Cantón** a
partir de las asignaciones ya cargadas (la unión de `porRecoger` y `porGestionar`),
con **una opción por cantón distinto** (deduplicado por cantón+provincia, insensible a
mayúsculas/acentos) y ordenadas alfabéticamente. La **etiqueta** de cada opción DEBE ser
`"<Cantón> (<Provincia>)"` usando `provinciaNombre` del DTO para desambiguar cantones
homónimos (p. ej. "Central (San José)" vs "Central (Alajuela)"); el **valor** usado para
filtrar sigue siendo el nombre del cantón.

**R3 (De estado).** MIENTRAS no haya un cantón seleccionado, el sistema DEBE mantener
el select de **Distrito deshabilitado** y sin filtro de distrito aplicado.

**R4 (Por evento).** CUANDO se selecciona un cantón, el sistema DEBE habilitar el
select de **Distrito** y poblarlo **exclusivamente** con los `distritoNombre` distintos
(no nulos) de las asignaciones cargadas cuyo `cantonNombre` es igual al cantón
seleccionado, deduplicados y ordenados alfabéticamente.

**R5 (Por evento).** CUANDO cambia el cantón seleccionado, el sistema DEBE **resetear**
la selección de distrito a "todos" (sin distrito).

**R6 (Condicional).** SI hay un cantón seleccionado, ENTONCES el sistema DEBE mostrar
en cada grupo únicamente las órdenes cuyo `cantonNombre` coincide; y SI además hay un
distrito seleccionado, ENTONCES DEBE mostrar únicamente las órdenes cuyo `cantonNombre`
y `distritoNombre` coinciden. Las órdenes con `distritoNombre === null` DEBEN quedar
excluidas cuando hay un distrito específico seleccionado.

**R7 (De estado).** MIENTRAS no haya cantón seleccionado ("todos"), el sistema DEBE
mostrar todas las órdenes cargadas de cada grupo, sin ningún estrechamiento.

**R8 (Por evento).** CUANDO el usuario elige la opción "Todos los cantones" / "Todos los
distritos", o activa "Limpiar filtros", el sistema DEBE limpiar el/los filtro(s)
correspondiente(s) y restaurar la lista completa. "Limpiar filtros" DEBE limpiar
**ambos** selects a la vez (cantón y distrito).

**R9 (Opcional).** DONDE haya al menos un filtro activo (cantón o distrito), el sistema
DEBE ofrecer un control "Limpiar filtros"; MIENTRAS no haya ningún filtro activo, ese
control NO DEBE estar disponible/activo.

**R10 (De estado — salvaguarda del bloqueo 1-a-1).** MIENTRAS haya una orden activa en
gestión (`ordenEnGestionId !== null`), esa orden DEBE permanecer visible en el grupo
"En reparto / por gestionar" **independientemente del filtro** (el filtro nunca oculta
la orden que se está gestionando).

**R11 (Condicional).** SI el filtro activo no produce ninguna coincidencia en un grupo,
ENTONCES el sistema DEBE mostrar un mensaje de "sin coincidencias con el filtro",
distinguible del mensaje base de "no hay órdenes" (grupo realmente vacío).

**R12 (Ubicuo).** El sistema DEBE derivar opciones y aplicar el filtro **100% en
cliente** a partir de los DTOs ya cargados; NO DEBE realizar ninguna petición de red ni
invocar Server Actions para filtrar u obtener opciones.

**R13 (Ubicuo — estabilidad de opciones).** El conjunto de opciones de Cantón DEBE
derivarse del conjunto completo cargado (no del subconjunto ya filtrado), de modo que la
selección actual no elimine otras opciones de cantón disponibles.

**R14 (De estado).** MIENTRAS haya un filtro activo, el panel de detalle y el mapa de
ruta de "En reparto" DEBEN reflejar el conjunto filtrado de órdenes (respetando la
salvaguarda R10), de forma que lo mostrado en el panel/mapa sea coherente con las cards
visibles. [CONFIRMADO — gate F1.4: criterio único del portal, alineado con la feature 114.]

## Trazabilidad (requisito → prueba prevista)

| Req | Prueba prevista (nombre descriptivo del test) |
| --- | --- |
| R1  | "renderiza los selects de Cantón y Distrito en el módulo del mensajero" |
| R2  | "las opciones de Cantón son los cantones únicos con etiqueta 'Cantón (Provincia)', ordenados" |
| R3  | "sin cantón elegido, el select de Distrito está deshabilitado" |
| R4  | "al elegir un cantón, Distrito ofrece solo los distritos de ese cantón" |
| R5  | "cambiar de cantón resetea el distrito a todos" |
| R6  | "filtrar por cantón+distrito muestra solo las órdenes coincidentes; excluye distrito nulo" |
| R7  | "sin filtro, se muestran todas las órdenes de cada grupo" |
| R8  | "elegir 'Todos' / 'Limpiar filtros' restaura la lista completa" |
| R9  | "'Limpiar filtros' solo aparece cuando hay un filtro activo" |
| R10 | "la orden en gestión sigue visible aunque el filtro no la incluya" |
| R11 | "filtro sin coincidencias muestra el mensaje 'sin coincidencias'" |
| R12 | "el filtrado no invoca Server Actions ni red (funciones puras)" |
| R13 | "elegir un distrito no elimina otras opciones de cantón" |
| R14 | "con filtro activo, el panel de detalle muestra una orden del conjunto filtrado" |

## Preguntas abiertas

1. **Alcance dentro del módulo.** La descripción dice "la lista del mensajero" (singular)
   pero el módulo tiene DOS grupos ("Por recoger" y "En reparto / por gestionar").
   Decisión tomada por defecto (documentada en `design.md`): el filtro aplica a **ambos**
   grupos y las opciones se derivan de la unión de ambos, por coherencia con la feature
   hermana 114 (buscador, que filtra ambos grupos) y con la redacción "las asignaciones
   cargadas". ¿Se confirma, o el filtro debe limitarse solo a "En reparto"?
2. **Cantones homónimos. [RESUELTA — gate F1.4]** Con provincia: la etiqueta de cada
   opción de cantón es `"<Cantón> (<Provincia>)"` (ver R2), usando `provinciaNombre` del
   DTO para desambiguar homónimos (p. ej. "Central"). La deduplicación de opciones es por
   cantón+provincia y el valor de filtrado sigue siendo el nombre del cantón.
3. **Órdenes sin distrito.** ¿Se desea una opción explícita "Sin distrito" para filtrar
   órdenes con `distritoNombre === null`? Por defecto NO se incluye (esas órdenes solo
   aparecen bajo "Todos los distritos").
4. **Mapa/panel bajo filtro. [RESUELTA — gate F1.4]** Confirmado: el mapa de ruta y el
   panel de detalle reflejan el subconjunto filtrado (con la salvaguarda R10). Es el
   criterio único del portal, alineado con la feature 114.
5. **Composición con el buscador (114).** Cuando aterrice la feature 114, ambos filtros de
   cliente deberían componerse en AND sobre las mismas listas. No bloquea a la 117, pero
   conviene confirmar el orden de integración (ver conflicto de archivos en `tasks.md`).
</content>
</invoke>
