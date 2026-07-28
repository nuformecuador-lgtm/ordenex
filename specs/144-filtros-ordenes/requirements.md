# Feature 144 — Filtros de órdenes (zona, tienda, geografía y tiempo) · requirements.md

> Zona: fullstack · Complejidad: high · depends_on: null
> Notación EARS estricta (`docs/specs.md`). Cada `R<n>` es testeable y sin detalle
> de implementación (el CÓMO va en `design.md`).
> Rama: `feature/144-filtros-ordenes` (worktree `ordenex-wt-144`, salida de
> `origin/dev @ 55b0cd4`).

## La feature son DOS piezas

- **(A) `FilterComponent` — componente de filtros genérico y parametrizable.**
  Recibe **por props** qué filtros monta, de qué tipo es cada uno y **los datos
  (opciones) de cada campo**, y emite por `onChange` la selección agregada en una
  forma **agnóstica del consumidor**, para que cualquier consumidor la envíe a
  cualquier endpoint o Server Action. No conoce dominio alguno. Es el hermano un
  nivel arriba de `MultiSelectFilter`: aquel es UN control, este **orquesta N
  controles** y es dueño del estado agregado.
- **(B) El cableado en órdenes** — único consumidor que se implementa en esta
  feature: las seis declaraciones concretas (zona, tienda, provincia, cantón,
  distrito, tiempo), la precarga de sus catálogos, y la inyección de la selección
  dentro del `filter` de `listarOrdenes`.

**Criterio de corte, aplicado requisito por requisito:** un requisito pertenece a (A)
si se puede escribir y testear **sin nombrar órdenes, zonas, provincias ni
distritos** (los tests de (A) usan filtros de fantasía). Si necesita nombrar una
entidad del dominio para tener sentido, pertenece a (B).

**Decisiones cerradas que esta feature NO reabre:** se extiende el `filter` de la
Server Action `listarOrdenes` (sin endpoint HTTP nuevo, sin query params en la URL
del navegador); el encadenamiento se resuelve en el cliente sobre datos precargados
en una sola entrega; el único consumidor implementado es órdenes.

---

## Contexto verificado en el repo (no inventado)

Todo lo de abajo se leyó en este worktree; nada se supone.

- **Transporte existente.** `listarOrdenes(input)` (`lib/actions/ordenes.ts`) valida
  con `listarOrdenesSchema` (`lib/types/orden.ts`), que incluye
  `filter: ordenFilterSchema.optional()`. `ordenFilterSchema` es `.strict()` y hoy
  admite una sola clave, `status_id`, con forma `string | [string, ...string[]]`
  (lista NO vacía). Una clave fuera de la whitelist produce `ZodError` →
  `validation_error` ANTES de construir el `where`.
- **Traducción.** `OrdenService.listar` mapea la clave pública a la columna por un
  mapa explícito `FILTER_TO_COLUMN = { status_id: "estatusId" }`, compone con el
  scoping por rol (`adminTienda` → `where.tiendaId = actor.usuarioId`; `mensajero`
  → `where.mensajeroAsignadoId = actor.usuarioId`) y delega a
  `OrdenRepository.list`, que traduce lista → `{ in: [...] }` y escalar → igualdad,
  con `deletedAt: null` siempre presente. El `count` usa el MISMO `where`.
- **La orden tiene geografía y zona propias.** `model Orden` (db/schema.prisma):
  `zonaId` (NOT NULL), `provinciaId` (NOT NULL), `cantonId` (NOT NULL),
  `distritoId` (NULLABLE, único FK geográfico opcional), `createdAt` (`DateTime`,
  UTC). Índices actuales de `orden`: `tiendaId`, `estatusId`, `createdAt`,
  `mensajeroSugeridoId`, `mensajeroAsignadoId`, `(mensajeroAsignadoId, asignadoAt)`.
  **No hay índice** sobre `zona_id`, `provincia_id`, `canton_id` ni `distrito_id`.
- **Zona ↔ distrito.** `Distrito.zonas` es N:M vía `ZonaDistrito` (la columna escalar
  `distrito.zona_id` fue eliminada en la migración `20260713000000`). La zona de una
  orden está congelada en `orden.zona_id`, y el mapa vivo distrito→zona puede
  divergir de él. → **pregunta abierta (b)**.
- **Catálogo geográfico de CR.** `public/geografia-cr-completa-NOTAS.md` (checksum
  del IGN): **7 provincias, 84 cantones, 491 distritos** = 582 filas.
- **Lecturas de catálogo existentes y su autorización.** `GeoService` (provincias /
  cantones-por-provincia / distritos-por-cantón) y `listarArbolGeografico()`
  (`lib/actions/geografia.ts`, árbol completo) son **exclusivas de `maestro`**.
  `ZonaService.listar` también es **exclusiva de `maestro`**. `listarUsuariosPorRol`
  / `listarAdminTiendas` (`UsuariosPorRolService`) permiten
  `adminTienda`/`maestro`/`admin` y devuelven `{id, nombre}` de usuarios `activo`
  del rol pedido. **Ninguna sirve tal cual** para poblar esta barra con rol `admin`.
- **Cuentas tienda.** El dueño de una orden es `orden.tiendaId` → `usuario`. Por
  sesión son usuarios de rol `adminTienda`; por API key (feature 88) son usuarios de
  rol `apiKey` (`BulkOrdenService` exige `actor.rol === "apiKey"` y usa su
  `usuarioId` como tienda). Enum `RolValue`: `maestro`, `admin`, `mensajero`,
  `adminTienda`, `adminSatelite`, `apiKey`.
- **Superficie front.** `app/(app)/ordenes/page.tsx` resuelve el rol server-side
  (`resolveActorFromSession`); `mensajero`/`adminSatelite` → `notFound()`;
  `maestro`/`admin`/`adminTienda` → `OrdenesListado`; el resto → `OrdenesModule`
  plano. `OrdenesListado` monta hoy `MultiSelectFilter` (estado) y pasa
  `filter={{status_id: [...] }}` a `OrdenesModule`. `OrdenesModule` serializa la
  lista de estados ordenada (`[...statusId].sort().join(",")`) para la key SWR y, al
  cambiar esa key, vuelve a página 1 y limpia la selección durante el render.
- **Control de UI ya disponible.** `components/shared/MultiSelectFilter.tsx` es un
  select múltiple **controlado** con buscador interno, casilla por opción,
  `role="listbox"`/`role="option"` + `aria-selected`, cierre por clic fuera y
  `Escape`. Es UI pura y sin dominio: el ladrillo con el que (A) monta cada control
  múltiple. `components/shared/TableFilters.tsx` NO aplica (emite
  `Record<string,string>` de inputs de texto, sin ids ni multi-selección).
- **Utilidad horaria.** `lib/utils/fecha-cr.ts` (`startOfDayCR`, `fechaCalendarioCR`)
  asume `America/Costa_Rica` = UTC−6 fijo (sin DST). Ojo: `startOfDayCR` devuelve la
  **medianoche UTC de la fecha calendario CR**, que NO es el mismo instante que la
  medianoche de CR (esa es 06:00 UTC).

---

# Bloque A — Componente de filtros genérico (`FilterComponent`)

> Requisitos **R1–R20**. Ninguno menciona órdenes ni geografía: se testean con
> filtros de fantasía (p. ej. `color` → `talla`).

### A.1 Declaración y composición

**R1.** El sistema DEBE ofrecer UN componente que monte y coordine N filtros
declarados por props, siendo N ≥ 1 y decidido por el consumidor.

**R2.** Cada filtro declarado DEBE definir al menos: una clave que lo identifica en
la salida, una etiqueta visible, su tipo de control y su lista de opciones; y cada
opción DEBE aportar el valor que se emite y el texto que se muestra.

**R3.** El componente DEBE renderizar los filtros en el mismo orden en que fueron
declarados (misma declaración, mismo orden).

**R4.** El componente NO DEBE obtener datos por sí mismo: todas las opciones de todos
los filtros DEBEN llegar por props, de modo que sea independiente del transporte con
el que el consumidor las haya conseguido.

**R5.** El componente NO DEBE interpretar ni transformar los valores de las opciones:
lo que emite para un filtro DEBEN ser exactamente los valores declarados en sus
opciones.

### A.2 Tipos de control

**R6.** El componente DEBE soportar un tipo de filtro de **selección múltiple** con
buscador interno sobre sus propias opciones.

**R7.** El componente DEBE soportar un tipo de filtro de **selección única**, en el
que elegir un valor sustituye al anterior y nunca coexisten dos.

**R8.** SI un filtro declara un tipo no soportado, ENTONCES el componente NO DEBE
renderizar ese filtro ni incluirlo en la salida, y DEBE seguir renderizando los demás.

**R9.** MIENTRAS un filtro no tenga ninguna opción disponible, su control DEBE
presentarse deshabilitado.

**R10.** DONDE el consumidor indique que los filtros están deshabilitados, todos los
controles DEBEN presentarse deshabilitados y NO DEBEN emitir cambios.

### A.3 Salida (`onChange`)

**R11.** CUANDO el usuario selecciona o deselecciona un valor en cualquiera de los
filtros, el componente DEBE emitir la selección COMPLETA y agregada de todos los
filtros en ese momento, indexada por la clave declarada de cada filtro.

**R12.** MIENTRAS el usuario escribe en el buscador interno de un filtro, el
componente NO DEBE emitir ningún cambio.

**R13.** La salida emitida NO DEBE incluir los filtros sin ninguna selección, de modo
que "sin filtros" sea una salida vacía distinguible.

**R14.** La forma de la salida DEBE ser independiente del consumidor: el componente
NO DEBE construir el objeto de consulta de ningún endpoint ni acción concretos; esa
traducción corresponde al consumidor.

### A.4 Dependencias declaradas entre filtros

**R15.** Un filtro DEBE poder declarar que **depende** de otro filtro, identificándolo
por su clave, sin que el componente conozca el significado de ninguno de los dos.

**R16.** MIENTRAS un filtro dependiente esté montado, sus opciones ofrecidas DEBEN
acotarse a las asociadas a la selección efectiva de su filtro padre; y la selección
efectiva de un filtro DEBE ser su propia selección cuando no está vacía, o el
conjunto completo de sus opciones ofrecidas cuando lo está.

**R17.** El acotamiento DEBE ser transitivo a lo largo de una cadena de dependencias
de profundidad arbitraria (si C depende de B y B depende de A, acotar A DEBE acotar
también las opciones de C).

**R18.** CUANDO cambia la selección de un filtro padre, el componente DEBE eliminar de
la selección de sus filtros dependientes —de forma transitiva— los valores que dejan
de estar ofrecidos, y la salida emitida (R11) DEBE reflejar ya esa eliminación, de
modo que nunca se emita una combinación incoherente.

**R19.** SI un filtro declara depender de una clave que no está declarada, ENTONCES el
componente DEBE tratarlo como filtro independiente (sin acotar sus opciones) y DEBE
seguir funcionando.

### A.5 Accesibilidad

**R20.** Cada filtro montado DEBE exponer un nombre accesible propio y, en los de
selección múltiple, el estado seleccionado / no seleccionado de cada opción DEBE ser
legible por lector de pantalla.

---

# Bloque B — Cableado en órdenes (único consumidor)

> Requisitos **R21–R51**.

### B.1 Contrato del filtro (backend)

**R21.** El sistema DEBE aceptar en el `filter` de `listarOrdenes`, además de
`status_id`, las claves públicas de filtro por **zona**, **tienda**, **provincia**,
**cantón**, **distrito** y **tiempo**, cada una opcional e independiente de las demás.

**R22.** SI el `filter` contiene una clave fuera de la lista blanca server-side,
ENTONCES el sistema DEBE responder `validation_error` y NO DEBE ejecutar ninguna
consulta.

**R23.** El sistema DEBE aceptar cada filtro de catálogo (zona, tienda, provincia,
cantón, distrito) como una LISTA NO VACÍA de identificadores no vacíos; SI se recibe
una lista vacía o un identificador vacío/no textual, ENTONCES el sistema DEBE
responder `validation_error` sin ejecutar la consulta.

**R24.** CUANDO el `filter` trae varios filtros distintos a la vez, el sistema DEBE
devolver únicamente las órdenes que satisfacen **todos** ellos (conjunción).

**R25.** CUANDO un filtro de catálogo trae varios identificadores, el sistema DEBE
devolver las órdenes que coinciden con **cualquiera** de ellos (disyunción dentro del
mismo filtro).

**R26.** SI un filtro de catálogo contiene un identificador inexistente o ajeno al
alcance del actor, ENTONCES el sistema DEBE tratarlo como criterio que **no coincide
con nada** y NUNCA como "sin filtro"; el resultado NO DEBE incluir órdenes que el
criterio no seleccione.

**R27.** El sistema DEBE aplicar el filtro **después** (y nunca en lugar) del alcance
por rol vigente; MIENTRAS el actor sea `adminTienda`, el sistema DEBE devolver
únicamente órdenes cuya tienda sea la suya, aunque el filtro de tienda pida otras.

**R28.** MIENTRAS el actor sea `mensajero`, el sistema DEBE seguir devolviendo
únicamente sus órdenes asignadas, con o sin filtros nuevos.

**R29.** El sistema DEBE aceptar el filtro de tiempo como **un solo valor** (no una
lista); SI se recibe una lista o un valor fuera del dominio admitido, ENTONCES el
sistema DEBE responder `validation_error` sin ejecutar la consulta.

**R30.** CUANDO el `filter` trae el filtro de tiempo, el sistema DEBE devolver
únicamente las órdenes cuya fecha de creación cae dentro del margen pedido,
calculando los bordes del margen en la zona horaria de operación (Costa Rica, UTC−6)
sobre la fecha de creación almacenada en UTC.

**R31.** El sistema DEBE validar el `filter` completo en el borde (esquema tipado)
antes de construir la condición de consulta, de modo que ningún nombre de columna ni
valor arbitrario alcance el motor de datos.

**R32.** El sistema DEBE calcular el total de resultados con exactamente las mismas
condiciones que la página devuelta, de modo que la paginación sea coherente con el
filtro aplicado.

**R33.** MIENTRAS no se proporcione ninguno de los filtros nuevos, el sistema DEBE
producir exactamente el mismo comportamiento y el mismo criterio de consulta que
antes de esta feature (sin regresión del contrato de `listarOrdenes`, incluidos el
`estatusId` escalar y `filter.status_id`).

**R34.** El sistema DEBE poder combinar los filtros nuevos con `status_id` en la misma
consulta, sin que ninguno anule al otro.

### B.2 Catálogo precargado de opciones

**R35.** El sistema DEBE entregar, para la superficie de órdenes, las opciones de los
cinco filtros de catálogo (zonas, cuentas tienda, provincias, cantones, distritos) en
**una sola entrega**, sin requerir una consulta adicional por cada selección del
usuario.

**R36.** Cada opción de catálogo entregada DEBE incluir su identificador y su nombre
visible, y las de cantón y distrito DEBEN incluir además el identificador de su
elemento padre (provincia y cantón, respectivamente), de modo que el encadenamiento
sea resoluble sin más datos.

**R37.** El sistema DEBE entregar las opciones de cada catálogo en un orden
determinista (misma entrada, mismo orden).

**R38.** Las opciones del filtro de tienda DEBEN ser las cuentas que pueden ser dueñas
de una orden, incluidas las cuentas de integración por API key.

**R39.** SI quien solicita el catálogo de filtros de órdenes no tiene sesión válida,
ENTONCES el sistema DEBE responder `unauthenticated` y NO DEBE devolver datos.

**R40.** SI quien solicita el catálogo de filtros de órdenes tiene un rol que no opera
el listado de órdenes, ENTONCES el sistema DEBE responder `forbidden` y NO DEBE
devolver datos.

**R41.** El catálogo de filtros NO DEBE exponer datos personales de las cuentas tienda
más allá del nombre visible necesario para el select.

### B.3 Barra de filtros de órdenes

**R42.** La superficie de órdenes DEBE construir su barra de filtros declarando los
seis filtros sobre el componente genérico del bloque A, sin implementar lógica propia
de selección, búsqueda, acotamiento ni poda.

**R43.** La superficie de órdenes DEBE declarar la cadena provincia → cantón →
distrito usando el contrato de dependencias del bloque A (R15–R18), de modo que
seleccionada una provincia el filtro de cantón ofrezca solo sus cantones, y
seleccionado un cantón el de distrito ofrezca solo los suyos.

**R44.** El acotamiento y la poda de la cadena geográfica DEBEN resolverse en el
cliente sobre las opciones ya precargadas, sin una consulta al servidor por selección.

**R45.** CUANDO el componente genérico emite la selección, la superficie de órdenes
DEBE traducirla a las claves del `filter` de `listarOrdenes` y enviar los
identificadores dentro de ese mismo `filter`; esa traducción DEBE ser responsabilidad
de la superficie de órdenes y no del componente genérico.

**R46.** MIENTRAS no haya ningún filtro nuevo seleccionado, el listado NO DEBE incluir
esas claves en el `filter`, de modo que la entrada enviada sea idéntica a la previa a
esta feature.

**R47.** CUANDO cambia cualquier filtro, el listado DEBE volver a la página 1 y
limpiar la selección de filas, igual que ya ocurre al cambiar el filtro de estado.

**R48.** El sistema DEBE derivar la identidad de caché/refetch del listado de una
serialización estable de los filtros, de modo que dos selecciones con los mismos
identificadores (en distinto orden o distinta identidad de objeto) compartan caché y
NO provoquen una nueva consulta.

**R49.** DONDE el rol del usuario esté acotado a su propia tienda, el filtro de tienda
NO DEBE declararse en su barra de filtros.

**R50.** SI el catálogo de opciones no puede cargarse, ENTONCES los filtros afectados
DEBEN quedar deshabilitados y el listado DEBE seguir funcionando sin esos filtros.

**R51.** En esta feature, órdenes DEBE ser el único consumidor del componente
genérico; el comportamiento observable de cualquier otra tabla o superficie de la
aplicación NO DEBE cambiar.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en la tabla R→test de `tasks.md`. Los tests
de **R1–R20 no pueden mencionar órdenes, zonas ni geografía**: usan filtros de
fantasía. El reviewer rechaza si falta alguno o si un test del bloque A importa
dominio.

---

## Preguntas abiertas

Las preguntas de decisión, con recomendación razonada, están en
`design.md > Preguntas abiertas` y se cierran en la puerta humana **F1.4**, no antes.
Resumen de las que bloquean requisitos:

- **(a)** Forma del filtro de tiempo (presets relativos vs. rango desde/hasta) →
  concreta R29/R30.
- **(b)** Zona por `orden.zona_id` (congelada) vs. derivada del distrito por el mapa
  N:M vigente → concreta R25/R26 para el filtro de zona.
- **(c)** Vía del precargado (prop desde el Server Component vs. Server Action
  cacheada) → concreta R35/R39/R40.
- **(d)** Alcance de las opciones de tienda: todas las cuentas dueñas posibles vs.
  solo las que tienen al menos una orden.
- **(e)** Estado de las cuentas tienda: solo `activo` o también inactivas con órdenes
  históricas.
- **(f)** Comportamiento del filtro de distrito frente a órdenes con
  `distrito_id = NULL`.
- **(g)** Persistencia de la selección de filtros entre navegaciones.
- **(h)** Cuentas `apiKey` mezcladas o distinguidas en el select de tienda.
- **(i)** ¿El componente genérico ofrece un "Limpiar todo"? → añadiría requisito a A.3.
- **(j)** ¿Estado controlado, no controlado o híbrido? → concreta R11/R13.
- **(k)** ¿Qué tipos de filtro soporta v1 además de múltiple y único (texto, rango de
  fechas, booleano)? → concreta R6/R7/R8.
- **(l)** Forma exacta del payload emitido (mapa clave→valores vs. lista de pares) →
  concreta R11/R14.
- **(m)** ¿Un filtro puede declarar más de un padre? → concreta R15/R17.
- **(n)** Ubicación del componente genérico teniendo hoy UN solo consumidor
  (`components/shared/` vs. junto a órdenes hasta la feature 145) → concreta R1.
