# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · requirements.md

> Zona: fullstack · Complejidad: high · depends_on: null
> Notación EARS estricta (`docs/specs.md`). Cada `R<n>` es testeable y sin detalle
> de implementación (el CÓMO va en `design.md`).
> Rama: `feature/144-filtros-ordenes` (worktree `ordenex-wt-144`, salida de
> `origin/dev @ 55b0cd4`).
> **Puerta F1.4 CERRADA por el humano el 2026-07-28** (ver
> `design.md > Decisiones cerradas`). Este documento ya incorpora las 14 decisiones.

## La feature son DOS piezas

- **(A) `FilterComponent` — componente de filtros genérico y parametrizable**
  (`components/shared/`, decisión (n)). Recibe **por props** qué filtros monta, de qué
  tipo es cada uno y **los datos (opciones) de cada campo**, y emite por `onChange` la
  selección agregada en una forma **agnóstica del consumidor**, para que cualquier
  consumidor la envíe a cualquier endpoint o Server Action. No conoce dominio alguno.
  Es el hermano un nivel arriba de `MultiSelectFilter`: aquel es UN control, este
  **orquesta N controles** y es dueño del estado agregado.
- **(B) El cableado en órdenes** — único consumidor que se implementa en esta feature:
  las declaraciones concretas (zona, tienda, provincia, cantón, distrito, preset de
  tiempo y rango de creación), la precarga de sus catálogos y la inyección de la
  selección dentro del `filter` de `listarOrdenes`.

**Criterio de corte, aplicado requisito por requisito:** un requisito pertenece a (A)
si se puede escribir y testear **sin nombrar órdenes, zonas, provincias ni distritos**
(los tests de (A) usan filtros de fantasía). Si necesita nombrar una entidad del
dominio para tener sentido, pertenece a (B).

**Decisiones cerradas que esta feature NO reabre:** se extiende el `filter` de la
Server Action `listarOrdenes` (sin endpoint HTTP nuevo, sin query params en la URL del
navegador); el encadenamiento se resuelve en el cliente sobre datos precargados en una
sola entrega; el catálogo se resuelve en el **Server Component** de `/ordenes` con
`Promise.all` y baja por props; el único consumidor implementado es órdenes.

---

## Contexto verificado en el repo (no inventado)

Todo lo de abajo se leyó en este worktree; nada se supone.

- **Transporte existente.** `listarOrdenes(input)` (`lib/actions/ordenes.ts`) valida con
  `listarOrdenesSchema` (`lib/types/orden.ts`), que incluye
  `filter: ordenFilterSchema.optional()`. `ordenFilterSchema` es `.strict()` y hoy
  admite una sola clave, `status_id`, con forma `string | [string, ...string[]]`
  (lista NO vacía). Una clave fuera de la whitelist produce `ZodError` →
  `validation_error` ANTES de construir el `where`.
- **Traducción.** `OrdenService.listar` mapea la clave pública a la columna por un mapa
  explícito `FILTER_TO_COLUMN = { status_id: "estatusId" }`, compone con el scoping por
  rol (`adminTienda` → `where.tiendaId = actor.usuarioId`; `mensajero` →
  `where.mensajeroAsignadoId = actor.usuarioId`) y delega a `OrdenRepository.list`, que
  traduce lista → `{ in: [...] }` y escalar → igualdad, con `deletedAt: null` siempre
  presente. El `count` usa el MISMO `where`.
- **La orden tiene geografía y zona propias.** `model Orden` (db/schema.prisma):
  `zonaId` (NOT NULL), `provinciaId` (NOT NULL), `cantonId` (NOT NULL), `distritoId`
  (**`String?` — NULLABLE**, único FK geográfico opcional), `createdAt` (`DateTime`,
  UTC). Índices actuales de `orden`: `tiendaId`, `estatusId`, `createdAt`,
  `mensajeroSugeridoId`, `mensajeroAsignadoId`, `(mensajeroAsignadoId, asignadoAt)`.
  **No hay índice** sobre `zona_id`, `provincia_id`, `canton_id` ni `distrito_id`.
- **Zona ↔ distrito.** `Distrito.zonas` es N:M vía `ZonaDistrito` (la columna escalar
  `distrito.zona_id` fue eliminada en la migración `20260713000000`). La zona de una
  orden está congelada en `orden.zona_id` (decisión (b)).
- **Catálogo geográfico de CR.** `public/geografia-cr-completa-NOTAS.md` (checksum del
  IGN): **7 provincias, 84 cantones, 491 distritos** = 582 filas.
- **Lecturas de catálogo existentes y su autorización.** `GeoService` y
  `listarArbolGeografico()` (`lib/actions/geografia.ts`) son **exclusivas de
  `maestro`**; `ZonaService.listar` también. `listarUsuariosPorRol` /
  `listarAdminTiendas` (`UsuariosPorRolService`) permiten `adminTienda`/`maestro`/
  `admin` y devuelven `{id, nombre}` de usuarios `activo` de UN rol.
  **Ninguna sirve tal cual** para poblar esta barra con rol `admin`.
- **Cuentas tienda.** El dueño de una orden es `orden.tiendaId` → `usuario`. Por sesión
  son usuarios de rol `adminTienda`; por API key (feature 88) son usuarios de rol
  `apiKey` (`BulkOrdenService` exige `actor.rol === "apiKey"` y usa su `usuarioId` como
  tienda). Enum `RolValue`: `maestro`, `admin`, `mensajero`, `adminTienda`,
  `adminSatelite`, `apiKey`.
- **Superficie front.** `app/(app)/ordenes/page.tsx` es Server Component y resuelve el
  rol server-side (`resolveActorFromSession`); `mensajero`/`adminSatelite` →
  `notFound()`; `maestro`/`admin`/`adminTienda` → `OrdenesListado`; el resto →
  `OrdenesModule` plano. `OrdenesListado` monta hoy `MultiSelectFilter` (estado) y pasa
  `filter={{status_id:[...]}}` a `OrdenesModule`. `OrdenesModule` serializa la lista de
  estados ordenada (`[...statusId].sort().join(",")`) para la key SWR y, al cambiar esa
  key, vuelve a página 1 y limpia la selección durante el render.
- **Controles de UI disponibles.** `components/shared/MultiSelectFilter.tsx` es un
  select múltiple **controlado** con buscador interno, casilla por opción,
  `role="listbox"`/`role="option"` + `aria-selected`, cierre por clic fuera y `Escape`;
  **hoy su lista de opciones es plana (sin grupos)**. `components/ui/select.tsx` es un
  wrapper propio sobre `@base-ui/react/select` con `options` planas.
  `components/shared/TableFilters.tsx` NO aplica (texto libre, sin ids).
- **Fechas en la UI.** `components/ui/` **no** tiene `calendar`, `popover` ni `command`.
  El repo NO usa Radix (las primitivas se construyeron sobre `@base-ui/react`), y no hay
  `react-day-picker` ni `date-fns` en `package.json`. El patrón vigente para fechas es
  `<Input type="date">`, usado en 6 componentes, incluido
  `app/(app)/wallet/_components/WalletFiltros.tsx`, que ya implementa un
  **desde/hasta** exactamente así.
- **Utilidad horaria.** `lib/utils/fecha-cr.ts` (`startOfDayCR`, `fechaCalendarioCR`)
  asume `America/Costa_Rica` = UTC−6 fijo (sin DST). Ojo: `startOfDayCR` devuelve la
  **medianoche UTC de la fecha calendario CR**, que NO es el mismo instante que la
  medianoche de CR (esa es 06:00 UTC).

---

# Bloque A — Componente de filtros genérico (`FilterComponent`)

> Requisitos **R1–R27**. Ninguno menciona órdenes ni geografía: se testean con filtros
> de fantasía (p. ej. `color` → `talla`).

### A.1 Declaración y composición

**R1.** El sistema DEBE ofrecer UN componente que monte y coordine N filtros declarados
por props, siendo N ≥ 1 y decidido por el consumidor.

**R2.** Cada filtro declarado DEBE definir al menos: una clave que lo identifica en la
salida, una etiqueta visible y su tipo de control; y los filtros basados en opciones
DEBEN declarar además su lista de opciones, cada una con el valor que se emite y el
texto que se muestra.

**R3.** El componente DEBE renderizar los filtros en el mismo orden en que fueron
declarados (misma declaración, mismo orden).

**R4.** El componente NO DEBE obtener datos por sí mismo: todas las opciones de todos
los filtros DEBEN llegar por props, de modo que sea independiente del transporte con el
que el consumidor las haya conseguido.

**R5.** El componente NO DEBE interpretar ni transformar los valores de las opciones: lo
que emite para un filtro de opciones DEBEN ser exactamente los valores declarados.

### A.2 Tipos de control

**R6.** El componente DEBE soportar un tipo de filtro de **selección múltiple** con
buscador interno sobre sus propias opciones.

**R7.** El componente DEBE soportar un tipo de filtro de **selección única**, en el que
elegir un valor sustituye al anterior y nunca coexisten dos.

**R8.** El componente DEBE soportar un tipo de filtro de **rango de fechas** con dos
extremos (inicial y final) que el usuario pueda fijar por separado, cada uno como fecha
de calendario.

**R9.** CUANDO el usuario fija o cambia un extremo del rango de fechas, el componente
DEBE emitir la selección agregada aunque el otro extremo esté vacío (rango abierto por
ese lado).

**R10.** SI el extremo inicial de un rango de fechas es posterior al extremo final,
ENTONCES el componente DEBE señalar el rango como inválido y NO DEBE emitir esa
combinación.

**R11.** SI un filtro declara un tipo no soportado, ENTONCES el componente NO DEBE
renderizar ese filtro ni incluirlo en la salida, y DEBE seguir renderizando los demás.

**R12.** MIENTRAS un filtro basado en opciones no tenga ninguna opción disponible, su
control DEBE presentarse deshabilitado.

**R13.** DONDE el consumidor indique que los filtros están deshabilitados, todos los
controles DEBEN presentarse deshabilitados y NO DEBEN emitir cambios.

### A.3 Salida (`onChange`)

**R14.** CUANDO el usuario selecciona o deselecciona un valor, o fija un extremo de un
rango de fechas, el componente DEBE emitir la selección COMPLETA y agregada de todos los
filtros en ese momento, indexada por la clave declarada de cada filtro.

**R15.** MIENTRAS el usuario escribe en el buscador interno de un filtro, el componente
NO DEBE emitir ningún cambio.

**R16.** La salida emitida NO DEBE incluir los filtros sin ninguna selección, de modo que
"sin filtros" sea una salida vacía distinguible.

**R17.** La salida DEBE tener una forma uniforme para todos los tipos —una lista de
cadenas por clave—, con esta convención: selección múltiple = N valores; selección única
= exactamente 1 valor; rango de fechas = exactamente 2 posiciones `[inicial, final]`,
usando cadena vacía en el extremo no fijado.

**R18.** La forma de la salida DEBE ser independiente del consumidor: el componente NO
DEBE construir el objeto de consulta de ningún endpoint ni acción concretos; esa
traducción corresponde al consumidor.

### A.4 Limpieza

**R19.** Cada filtro montado DEBE poder limpiarse individualmente, incluido el de rango
de fechas, y esa limpieza DEBE emitir la selección resultante.

**R20.** DONDE el consumidor lo habilite, el componente DEBE ofrecer una acción "Limpiar
todo" que vacíe la selección de TODOS los filtros y emita una salida vacía una sola vez.

### A.5 Dependencias declaradas entre filtros

**R21.** Un filtro DEBE poder declarar que **depende** de otro filtro, identificándolo
por su clave, sin que el componente conozca el significado de ninguno de los dos.

**R22.** MIENTRAS un filtro dependiente esté montado, sus opciones ofrecidas DEBEN
acotarse a las asociadas a la selección efectiva de su filtro padre; y la selección
efectiva de un filtro DEBE ser su propia selección cuando no está vacía, o el conjunto
completo de sus opciones ofrecidas cuando lo está.

**R23.** El acotamiento DEBE ser transitivo a lo largo de una cadena de dependencias de
profundidad arbitraria (si C depende de B y B depende de A, acotar A DEBE acotar también
las opciones de C).

**R24.** CUANDO cambia la selección de un filtro padre, el componente DEBE eliminar de la
selección de sus filtros dependientes —de forma transitiva— los valores que dejan de
estar ofrecidos, y la salida emitida (R14) DEBE reflejar ya esa eliminación, de modo que
nunca se emita una combinación incoherente.

**R25.** SI un filtro declara depender de una clave que no está declarada, ENTONCES el
componente DEBE tratarlo como filtro independiente (sin acotar sus opciones) y DEBE
seguir funcionando.

### A.6 Agrupado y accesibilidad

**R26.** Una opción DEBE poder declarar el grupo al que pertenece; MIENTRAS un filtro
tenga opciones con grupo, sus opciones DEBEN presentarse bajo la cabecera de su grupo, con
el nombre del grupo expuesto de forma accesible; MIENTRAS ninguna opción declare grupo, la
lista DEBE presentarse plana, sin cabeceras.

**R27.** Cada filtro montado DEBE exponer un nombre accesible propio y, en los de
selección múltiple, el estado seleccionado / no seleccionado de cada opción DEBE ser
legible por lector de pantalla.

---

# Bloque B — Cableado en órdenes (único consumidor)

> Requisitos **R28–R63**.

### B.1 Contrato del filtro (backend)

**R28.** El sistema DEBE aceptar en el `filter` de `listarOrdenes`, además de
`status_id`, claves para filtrar por **zona**, **tienda**, **provincia**, **cantón**,
**distrito**, **preset de antigüedad de creación**, **fecha de creación desde** y **fecha
de creación hasta**, todas opcionales e independientes entre sí.

**R29.** SI el `filter` contiene una clave fuera de la lista blanca server-side, ENTONCES
el sistema DEBE responder `validation_error` y NO DEBE ejecutar ninguna consulta.

**R30.** El sistema DEBE aceptar cada filtro de catálogo (zona, tienda, provincia, cantón,
distrito) como una LISTA NO VACÍA de identificadores no vacíos; SI se recibe una lista
vacía o un identificador vacío/no textual, ENTONCES el sistema DEBE responder
`validation_error` sin ejecutar la consulta.

**R31.** CUANDO el `filter` trae varios filtros distintos a la vez, el sistema DEBE
devolver únicamente las órdenes que satisfacen **todos** ellos (conjunción).

**R32.** CUANDO un filtro de catálogo trae varios identificadores, el sistema DEBE
devolver las órdenes que coinciden con **cualquiera** de ellos (disyunción dentro del
mismo filtro).

**R33.** SI un filtro de catálogo contiene un identificador inexistente o ajeno al alcance
del actor, ENTONCES el sistema DEBE tratarlo como criterio que **no coincide con nada** y
NUNCA como "sin filtro"; el resultado NO DEBE incluir órdenes que el criterio no
seleccione.

**R34.** El sistema DEBE aplicar el filtro **después** (y nunca en lugar) del alcance por
rol vigente; MIENTRAS el actor sea `adminTienda`, el sistema DEBE devolver únicamente
órdenes cuya tienda sea la suya, aunque el filtro de tienda pida otras.

**R35.** MIENTRAS el actor sea `mensajero`, el sistema DEBE seguir devolviendo únicamente
sus órdenes asignadas, con o sin filtros nuevos.

**R36.** El sistema DEBE aceptar el preset de antigüedad como **un solo valor** de un
dominio cerrado; SI se recibe una lista o un valor fuera de ese dominio, ENTONCES el
sistema DEBE responder `validation_error` sin ejecutar la consulta.

**R37.** El sistema DEBE aceptar las fechas del rango como fechas de calendario en formato
`YYYY-MM-DD`; SI el formato es inválido, o la fecha inicial es posterior a la final,
ENTONCES el sistema DEBE responder `validation_error` sin ejecutar la consulta.

**R38.** CUANDO el `filter` trae el preset de antigüedad de N días, el sistema DEBE
devolver únicamente las órdenes creadas desde el inicio del día de Costa Rica
correspondiente a hace N−1 días, calculado sobre la fecha de creación almacenada en UTC.

**R39.** CUANDO el `filter` trae fecha desde y/o hasta, el sistema DEBE devolver únicamente
las órdenes cuya creación cae dentro del rango en horario de Costa Rica, siendo el extremo
inicial el comienzo de ese día y el extremo final **inclusive** (todo el día indicado); y
SI solo llega uno de los dos extremos, ENTONCES el rango DEBE quedar abierto por el otro
lado.

**R40.** SI el `filter` trae a la vez el preset de antigüedad y el rango de fechas,
ENTONCES el sistema DEBE aplicar el rango de fechas e ignorar el preset, de forma
determinista y documentada.

**R41.** El sistema DEBE validar el `filter` completo en el borde (esquema tipado) antes de
construir la condición de consulta, de modo que ningún nombre de columna ni valor
arbitrario alcance el motor de datos; y los bordes temporales DEBEN calcularse
server-side, sin aceptar instantes absolutos derivados del reloj del cliente.

**R42.** El sistema DEBE calcular el total de resultados con exactamente las mismas
condiciones que la página devuelta, de modo que la paginación sea coherente con el filtro
aplicado.

**R43.** MIENTRAS no se proporcione ninguno de los filtros nuevos, el sistema DEBE producir
exactamente el mismo comportamiento y el mismo criterio de consulta que antes de esta
feature (sin regresión del contrato de `listarOrdenes`, incluidos el `estatusId` escalar y
`filter.status_id`).

**R44.** El sistema DEBE poder combinar los filtros nuevos con `status_id` en la misma
consulta, sin que ninguno anule al otro.

### B.2 Catálogo de opciones precargado

**R45.** El sistema DEBE resolver los catálogos de los filtros de órdenes (zonas, cuentas
tienda, provincias, cantones, distritos) **en el servidor y en paralelo** durante la carga
de la página de órdenes, y entregarlos al cliente en la respuesta inicial, de modo que los
filtros estén operativos sin una petición posterior ni una consulta por cada selección del
usuario.

**R46.** Cada opción de catálogo entregada DEBE incluir su identificador y su nombre
visible, y las de cantón y distrito DEBEN incluir además el identificador de su elemento
padre (provincia y cantón, respectivamente), de modo que el encadenamiento sea resoluble
sin más datos.

**R47.** El sistema DEBE entregar las opciones de cada catálogo en un orden determinista
(misma entrada, mismo orden).

**R48.** Las opciones del filtro de tienda DEBEN ser todas las cuentas que pueden ser
dueñas de una orden, incluidas las cuentas de integración por API key y las cuentas
inactivas.

**R49.** Las cuentas de integración por API key DEBEN ofrecerse en un grupo distinto del de
las cuentas tienda por sesión, y las cuentas inactivas DEBEN ser distinguibles de las
activas en el texto visible de su opción.

**R50.** SI quien resuelve el catálogo de filtros de órdenes no tiene sesión válida,
ENTONCES el sistema DEBE responder `unauthenticated` y NO DEBE devolver datos.

**R51.** SI quien resuelve el catálogo de filtros de órdenes tiene un rol que no opera el
listado de órdenes, ENTONCES el sistema DEBE responder `forbidden` y NO DEBE devolver
datos.

**R52.** El catálogo de filtros NO DEBE exponer datos personales de las cuentas tienda más
allá del nombre visible necesario para el select.

### B.3 Barra de filtros de órdenes

**R53.** La superficie de órdenes DEBE construir su barra de filtros declarando sus filtros
sobre el componente genérico del bloque A, sin implementar lógica propia de selección,
búsqueda, acotamiento, agrupado ni poda.

**R54.** La superficie de órdenes DEBE declarar la cadena provincia → cantón → distrito
usando el contrato de dependencias del bloque A (R21–R25), de modo que seleccionada una
provincia el filtro de cantón ofrezca solo sus cantones, y seleccionado un cantón el de
distrito ofrezca solo los suyos.

**R55.** El acotamiento y la poda de la cadena geográfica DEBEN resolverse en el cliente
sobre las opciones ya precargadas, sin una consulta al servidor por selección.

**R56.** CUANDO el componente genérico emite la selección, la superficie de órdenes DEBE
traducirla a las claves del `filter` de `listarOrdenes` —incluida la conversión del rango
de fechas a sus dos claves y la del filtro único a valor escalar— y enviar los
identificadores dentro de ese mismo `filter`; esa traducción DEBE ser responsabilidad de la
superficie de órdenes y no del componente genérico.

**R57.** MIENTRAS no haya ningún filtro nuevo seleccionado, el listado NO DEBE incluir esas
claves en el `filter`, de modo que la entrada enviada sea idéntica a la previa a esta
feature.

**R58.** CUANDO cambia cualquier filtro, el listado DEBE volver a la página 1 y limpiar la
selección de filas, igual que ya ocurre al cambiar el filtro de estado.

**R59.** El sistema DEBE derivar la identidad de caché/refetch del listado de una
serialización estable de los filtros, de modo que dos selecciones con los mismos valores (en
distinto orden o distinta identidad de objeto) compartan caché y NO provoquen una nueva
consulta.

**R60.** DONDE el rol del usuario esté acotado a su propia tienda, el filtro de tienda NO
DEBE declararse en su barra de filtros.

**R61.** La barra de filtros de órdenes DEBE ofrecer la acción "Limpiar todo" además de la
limpieza individual de cada filtro.

**R62.** SI los catálogos no están disponibles, ENTONCES los filtros afectados DEBEN quedar
deshabilitados y el listado DEBE seguir funcionando sin esos filtros.

**R63.** En esta feature, órdenes DEBE ser el único consumidor del componente genérico; el
comportamiento observable de cualquier otra tabla o superficie de la aplicación NO DEBE
cambiar.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en la tabla R→test de `tasks.md`. Los tests de
**R1–R27 no pueden mencionar órdenes, zonas ni geografía**: usan filtros de fantasía. El
reviewer rechaza si falta alguno o si un test del bloque A importa dominio.

---

## Preguntas abiertas

**Ninguna bloqueante.** Las 14 preguntas (a)–(n) quedaron cerradas en la puerta F1.4 del
2026-07-28; su decisión y su consecuencia de diseño están en
`design.md > Decisiones cerradas (gate F1.4, 2026-07-28)`.

Dos puntos que el spec **decide** (no eran preguntas del humano) y que quedan señalados
por si el humano quiere lo contrario; no bloquean la implementación:

1. **Precedencia preset ↔ rango (R40).** Con ambos presentes gana el rango explícito. La
   alternativa —rechazar la combinación con `validation_error`— haría alcanzable un error
   por simple uso de la UI, dado que el estado de (A) es no controlado (decisión (j)) y el
   consumidor no puede vaciar el preset al fijar un rango. Ver `design.md §2.5`.
2. **Órdenes con `distrito_id = NULL` (decisión (f)).** Se mantienen fuera del filtro de
   distrito. El humano afirma que **no debería existir** ninguna; **verificado en el
   schema: la columna SÍ es nullable hoy** (`distritoId String?`). Confirmar el dato real
   y, en su caso, volverla `NOT NULL`, es trabajo de otra feature — anotado en
   `design.md > Riesgos`, fuera del alcance de esta.
