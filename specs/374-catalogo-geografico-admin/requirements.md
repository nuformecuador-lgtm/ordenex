# Ficha 374 — Administrar el catálogo geográfico desde la app · requirements

> **Estado:** borrador para la puerta de aprobación humana (`spec_ready`).
> **Zona:** `fullstack` · **Complejidad:** media · **Rama:** `feat/374-catalogo-geografico-admin`.
> **Frontera fijada por el humano (2026-09-05):** quitar es **desactivar**, nunca borrado físico;
> el **renombrado queda fuera** (§4); los **148 distritos sin zona no se tocan**.

## 0. Contexto verificado (no supuesto)

### 0.1 De dónde sale la ficha

Operaciones reportó que faltaba el distrito **Cabagra** (Buenos Aires, Puntarenas). Eran tres: la
base tenía **491** distritos y la DTA 2026 del IGN tiene **494**. El arreglo salió por migración
—`db/migrations/20260905175156_geografia_dta_2026_distritos_faltantes/migration.sql`, ya en
producción— pero la causa de fondo sigue: el catálogo **solo** se puebla por SQL de migración o
por `scripts/seed-zonas.ts` (CLI). El comentario de cabecera de `lib/actions/geografia.ts:8-12` lo
dice con todas las letras: *«el catalogo en si es de solo lectura»*.

### 0.2 Confirmado leyendo el árbol, archivo por archivo, el 2026-09-05

| Afirmación | Dónde se confirmó |
| --- | --- |
| `provincia`, `canton` y `distrito` **no tienen** ninguna columna de estado ni ningún índice único sobre el nombre | `db/schema.prisma:508-549` · y lo dice también la migración de la DTA (`…distritos_faltantes/migration.sql:23-25`) |
| Las tres tablas **ya tienen RLS** habilitada desde su creación | `db/migrations/20260709130000_ordenes_catalogos_geografia/migration.sql:71-73` |
| El precedente de la forma `activo` es `gasto_fijo_plantilla.activa BOOLEAN @default(true)` | `db/schema.prisma:1874` |
| `distrito.zona_especial` es `Boolean?` **a propósito** (tri-valuada: `null` = «nadie lo decidió») | `db/schema.prisma:537-541` · `db/migrations/20260824180000_distrito_zona_especial/migration.sql:12-31` |
| El catálogo de filtros es **UNO SOLO** y lo comparten seis superficies | `lib/actions/filtros-ordenes.ts:37` ← `app/(app)/ordenes/page.tsx:39`, `app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx:240`, `app/(app)/analitica/_components/operativo/FiltrosOperativos.tsx:94`, `app/(app)/_components/FiltrosEntregas.tsx:56`, `app/(app)/recepcion-satelite/en-bodega/page.tsx:114`, `app/(app)/historico/conversaciones/page.tsx:69` |
| El precedente de «bandera en el DTO, filtrado en el consumidor» es `CuentaTiendaDTO.activa` | `lib/types/filtros-ordenes.ts:42-45` (ficha 351) |
| `resolveGeo` evalúa provincia/cantón/distrito sobre la clave **normalizada** (`normalizeName`) | `lib/services/geo-resolucion.ts:28-30,42-51,91-153` · `lib/utils/normalize.ts:7-14` |
| Los tres mensajes de no-cobertura de `resolveGeo` los comparten la carga masiva **y** la cotización por API key | `lib/services/geo-resolucion.ts:1-9` · `lib/services/CotizacionOrdenService.ts:326-335` |
| El contrato público publica esos mensajes como **error de fila**, no como 422 del lote | `lib/api/openapi-spec.ts:634` · `docs/api/api-key-openapi.yaml:528,1316-1329` |
| `ZonaRepository.update` **reemplaza entera** la N:M `zona_distrito` con lo que mande el formulario | `lib/repositories/ZonaRepository.ts:230-235` |
| …y si un distrito queda con 0 zonas, la reconciliación hace `continue` **sin ruido** | `lib/repositories/ZonaRepository.ts:266-267` |
| El selector de Tarifas recibe `initialSelected` = los distritos actuales de la zona | `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx:331-336` |
| El colapso 1/0/>1 de la N:M vive en UN solo sitio, con su porqué escrito | `lib/repositories/_shared/zona-colapso.ts:12-17` |
| `scripts/seed-zonas.ts` resuelve el padre por nombre **exacto** y, si no lo encuentra, **crea** | `scripts/seed-zonas.ts:109-140` |
| …y cuando lo encuentra **no escribe nada** (no hay `update`, ni siquiera vacío) | `scripts/seed-zonas.ts:110-111,121,134` |
| El molde de capas a copiar es vehículos: acción → service → repositorio, con `deps` inyectables | `lib/actions/vehiculos.ts:34-42,64-82` · `lib/services/VehiculoService.ts:17-37` · `lib/repositories/VehiculoRepository.ts` |
| El UNIQUE de la base es «la última palabra» y el `catch` lo cuenta como `conflict` | `lib/actions/vehiculos.ts:75-81` |
| El menú de Configuración es un array de `children`, hoy con cinco entradas | `lib/auth/menu-visibility.ts:497-507` |
| `primerDestino` mira el **primer** hijo del **primer** ítem visible: añadir al final no mueve el aterrizaje de nadie | `lib/auth/menu-visibility.ts:665-669` |
| Hay un `toEqual` literal con los cinco `href` de Configuración que **hay que actualizar a mano** | `tests/unit/auth/menu-visibility.test.ts:305-317` |
| El par Badge + Activar/Desactivar ya existe, con su módulo puro de texto | `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx:362-394` |
| Los conteos de la landing cuentan «distritos con cobertura» | `lib/repositories/ConteosPublicosRepository.ts:33-35` |

### 0.3 Tres cosas del encargo que el código **no** confirma tal cual

Se dejan escritas en vez de repetirse:

1. **`/dashboard` NO es consumidor del catálogo.** `app/(app)/dashboard/page.tsx` no importa
   `obtenerCatalogoFiltrosOrdenes`; `FiltrosEntregas` —la barra que el comentario de
   `CorregirDatosClienteModal.tsx:224` llama «la de `/dashboard`»— hoy solo se monta desde
   `app/(app)/analitica/page.tsx:252`. Los consumidores medidos son **seis** y están en §0.2, pero
   la lista no es la del encargo.
2. **El precedente de vehículos normaliza MENOS de lo que esta ficha necesita.**
   `VehiculoService.crear` (`:34`) compara con `repo.findByName`, que es un `findUnique` por el
   nombre **exacto** (`VehiculoRepository.ts:32-35`); lo único que se pliega antes es
   `trim` + colapso de espacios (`lib/types/vehiculos.ts:25-27`). Ahí «Moto» y «moto» son dos filas
   legales. Aquí no pueden serlo, porque `resolveGeo` indexa por `normalizeName` (minúsculas **y**
   sin acentos): la forma del patrón se copia, la **clave** es más fuerte (§2.C, R17).
3. **`seed-zonas.ts` no usa `update: {}`.** El `update: {}` que se citó vive en
   `scripts/seed-catalogos.ts:18,34` (tipos de identificación y roles). `seed-zonas.ts` es aún más
   inofensivo: cuando encuentra la fila **devuelve su id y no escribe** (`:110-111`). La conclusión
   del encargo se sostiene —el seed no reactiva lo desactivado— y por un motivo más fuerte.

---

## 1. Glosario

- **Nivel** — uno de `provincia`, `canton`, `distrito`.
- **Nodo** — una fila de cualquiera de esas tres tablas.
- **Flag propio** — el valor de `activo` de ESA fila. Es una decisión sobre ese nodo y nada más.
- **Disponibilidad efectiva** — `distrito.activo AND canton.activo AND provincia.activo` para un
  distrito; `canton.activo AND provincia.activo` para un cantón; `provincia.activo` para una
  provincia. **Se evalúa al leer; no se guarda en ninguna columna.**
- **Retirado** — nodo cuya disponibilidad efectiva es falsa, por su flag propio o por herencia.
- **Inactivo heredado** — nodo con flag propio `true` cuya disponibilidad efectiva es falsa porque
  un ascendiente está inactivo.
- **Zona utilizable de un distrito** — la que resulta del colapso 1/0/>1 de
  `_shared/zona-colapso.ts`: `null` con 0 zonas **y también** con más de una.
- **Sin zona** — distrito cuya zona utilizable es `null`. Hoy son 148 y **es intencional**
  (territorio sin cobertura comercial): no se tocan.
- **Catálogo de filtros** — lo que devuelve `obtenerCatalogoFiltrosOrdenes()`, compartido por las
  seis superficies de §0.2.
- **Canal por API key** — el contrato público (`/api/ordenes/api-key/carga` y `/cotizacion`).

---

## 2. Requisitos

### A · Modelo y migración

- **R1** — El sistema DEBE registrar en `provincia`, `canton` y `distrito` una marca de activación
  booleana, obligatoria, cuyo valor por omisión sea «activo», de modo que toda fila existente al
  aplicar el cambio quede activa y ninguna quede sin valor.

- **R2** — El sistema DEBE poder revertir esa migración dejando las tres tablas exactamente como
  estaban antes de aplicarla, sin borrar ni modificar ninguna fila de provincia, cantón, distrito
  ni `zona_distrito`.

- **R3** — El sistema DEBE rechazar en la base de datos dos provincias con el mismo nombre, dos
  cantones con el mismo nombre dentro de la misma provincia, y dos distritos con el mismo nombre
  dentro del mismo cantón.

- **R4** — El sistema NO DEBE crear ningún índice cuya única columna sea la marca de activación en
  ninguna de las tres tablas.

- **R5** — El sistema NO DEBE ofrecer, en ninguna capa alcanzable desde la aplicación, el borrado
  físico de una provincia, un cantón o un distrito, y la verificación DEBE fallar si aparece en el
  árbol una sentencia de borrado sobre cualquiera de esas tres tablas.

- **R6** — MIENTRAS todas las filas del catálogo estén activas, el sistema DEBE devolver en cada
  una de las lecturas afectadas por esta ficha exactamente el mismo conjunto de filas que devolvía
  antes de ella.

### B · La cascada, que se evalúa y no se materializa

- **R7** — El sistema DEBE derivar la disponibilidad de un nodo de la conjunción de su flag propio
  con los de todos sus ascendientes, y NO DEBE guardar esa disponibilidad en ninguna columna.

- **R8** — CUANDO un usuario desactiva o reactiva un nodo, el sistema DEBE escribir el flag de
  **esa sola fila** y NO DEBE modificar ninguna fila de sus descendientes.

- **R9** — CUANDO un usuario reactiva un nodo que había desactivado, el sistema DEBE dejar a todos
  sus descendientes con exactamente los mismos flags propios que tenían justo antes de la
  desactivación.

- **R10** — El sistema DEBE admitir como estado válido un distrito con flag propio activo bajo un
  cantón inactivo, DEBE representarlo como «disponible: no, por herencia» y NO DEBE tratarlo como
  una inconsistencia que haya que corregir.

- **R11** — El sistema DEBE resolver la disponibilidad efectiva con una única definición
  compartida, y la verificación DEBE fallar si alguna lectura la reimplementa por su cuenta.

### C · Dar de alta

- **R12** — El sistema DEBE permitir a un usuario con rol `maestro` dar de alta una provincia, un
  cantón dentro de una provincia y un distrito dentro de un cantón.

- **R13** — CUANDO el sistema da de alta un nodo, ese nodo DEBE nacer activo.

- **R14** — SI el padre indicado en un alta no existe, ENTONCES el sistema DEBE responder «no
  encontrado» y NO DEBE crear ninguna fila.

- **R15** — SI el padre indicado en un alta existe pero no está disponible, ENTONCES el sistema
  DEBE crear el nodo igualmente, y ese nodo DEBE quedar con flag propio activo y disponibilidad
  efectiva falsa.

- **R16** — CUANDO el sistema persiste el nombre de un nodo, DEBE guardarlo recortado y con los
  espacios internos colapsados, y NO DEBE alterar sus mayúsculas ni sus acentos.

- **R17** — SI el nombre de un alta coincide, **comparado por su forma normalizada** —sin
  distinguir mayúsculas, acentos ni espacios sobrantes—, con el de otro nodo del mismo nivel y del
  mismo padre, ENTONCES el sistema DEBE rechazar el alta como conflicto y NO DEBE crear ninguna
  fila, esté ese hermano activo o inactivo.

- **R18** — SI dos altas simultáneas superan la comprobación de R17 y la base rechaza la segunda,
  ENTONCES el sistema DEBE contarla como conflicto y NO DEBE propagar un error crudo del motor.

- **R19** — El sistema DEBE aceptar un alta cuyo nombre ya exista bajo **otro** padre del mismo
  nivel.

### D · Desactivar y reactivar

- **R20** — El sistema DEBE permitir a un usuario con rol `maestro` desactivar y reactivar
  cualquier provincia, cantón o distrito.

- **R21** — CUANDO un usuario pide poner un nodo en el estado en que ya está, el sistema DEBE
  responder con éxito y DEBE dejar la fila con ese mismo estado.

- **R22** — SI el nodo indicado no existe, ENTONCES el sistema DEBE responder «no encontrado» y NO
  DEBE modificar ninguna fila.

### E · Autorización y borde

- **R23** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla como no
  autenticada y NO DEBE consultar ni escribir en la base.

- **R24** — SI el actor no tiene rol `maestro`, ENTONCES el sistema DEBE rechazar la operación como
  prohibida y NO DEBE consultar ni escribir en la base.

- **R25** — SI la entrada no identifica un nivel válido, no trae los campos que ese nivel exige, o
  trae claves desconocidas, ENTONCES el sistema DEBE rechazarla como error de validación en el
  borde y NO DEBE consultar la base.

### F · Cada sitio que lee el catálogo

- **R26** — El árbol que alimenta la pantalla de administración DEBE incluir **todos** los nodos,
  activos e inactivos, y DEBE exponer el flag propio de cada uno.

- **R27** — El árbol DEBE señalar, para cada distrito, si tiene o no una zona utilizable, aplicando
  el mismo colapso 1/0/>1 que usa la carga masiva.

- **R28** — Las lecturas planas que alimentan el catálogo de filtros DEBEN devolver **todos** los
  nodos, activos e inactivos, y DEBEN exponer la disponibilidad efectiva de cada uno.

- **R29** — Los desplegables de provincia, cantón y distrito de la corrección de ubicación DEBEN
  ofrecer únicamente nodos disponibles.

- **R30** — SI una corrección de ubicación llega al servidor con un distrito no disponible,
  ENTONCES el sistema DEBE rechazarla con un motivo que diga que el distrito fue retirado, DEBE
  distinguirlo del motivo «el distrito indicado no existe» y NO DEBE escribir nada.

- **R31** — Las lecturas geográficas que alimentan la carga masiva y la corrección DEBEN seguir
  devolviendo los distritos retirados, exponiendo su disponibilidad, y NO DEBEN recortarlos en la
  consulta.

- **R32** — SI una fila de carga o de cotización nombra una provincia, un cantón o un distrito
  retirado, ENTONCES el sistema DEBE rechazar esa fila con un mensaje propio que diga que el nodo
  fue retirado del catálogo, distinto de «no encontrado» y de «ambiguo».

- **R33** — CUANDO más de un nivel de la terna esté retirado, el sistema DEBE informar siempre del
  mismo, según una precedencia fija y declarada: provincia, luego cantón, luego distrito.

- **R34** — Los conteos públicos de la landing DEBEN contar únicamente distritos disponibles.

- **R35** — El sistema DEBE seguir listando y seguir dejando filtrar por su identificador las
  órdenes históricas cuyo distrito, cantón o provincia hayan sido retirados.

### G · El canal por API key

- **R36** — CUANDO una fila de un lote es rechazada por R32, el sistema DEBE devolverla dentro de
  la lista de errores de la respuesta, DEBE seguir procesando las demás filas del lote y NO DEBE
  responder con un error de lote.

- **R37** — El contrato publicado del canal DEBE declarar el rechazo de R32 en sus **dos**
  artefactos —el objeto que sirve el endpoint de documentación y su espejo textual— y el cambio
  DEBE quedar anotado como entrada fechada del changelog del canal antes de la release.

### H · La pantalla

- **R38** — El sistema DEBE ofrecer en `/configuracion/geografia` la administración del catálogo, y
  SI el actor no tiene rol `maestro`, ENTONCES la página DEBE negar el acceso sin mostrar datos.

- **R39** — La pantalla DEBE presentar los tres niveles anidados, con un buscador por texto que
  encuentre por nombre sin distinguir mayúsculas, acentos ni espacios sobrantes.

- **R40** — MIENTRAS un nodo tenga flag propio inactivo, la pantalla DEBE marcarlo como inactivo; y
  MIENTRAS un nodo esté inactivo solo por herencia, DEBE marcarlo de una forma distinta que nombre
  al ascendiente responsable.

- **R41** — MIENTRAS un nodo esté inactivo solo por herencia, la acción de activarlo DEBE
  presentarse deshabilitada, y su motivo DEBE ser perceptible sin llegar a pulsarla.

- **R42** — La pantalla DEBE señalar en la fila de cada distrito si no tiene zona utilizable.

- **R43** — La pantalla DEBE permitir dar de alta un nodo en cada uno de los tres niveles,
  indicando su padre cuando el nivel lo exija.

- **R44** — CUANDO un usuario pide desactivar un nodo, el sistema DEBE pedir una confirmación
  explícita; SI la desactivación dejaría a alguna zona sin ningún distrito disponible, ENTONCES la
  confirmación DEBE nombrar esas zonas, y el sistema NO DEBE impedir la desactivación por ese
  motivo.

- **R45** — CUANDO una operación de la pantalla termina, el sistema DEBE releer el árbol visible y
  DEBE avisar al usuario con un mensaje distinto para cada desenlace —éxito, conflicto, no
  encontrado, sin permiso, sin sesión, validación—.

- **R46** — El sistema DEBE ofrecer la pantalla como subítem de Configuración en el menú, y esa
  incorporación NO DEBE cambiar el destino al que aterriza ningún rol después de entrar.

### I · El blindaje del selector de Tarifas

- **R47** — El selector geográfico de Tarifas DEBE renderizar los nodos retirados, DEBE marcarlos
  visualmente como tales y DEBE mantener su casilla operable.

- **R48** — CUANDO se guarda una zona sin tocar el selector, el conjunto de distritos asociados a
  esa zona DEBE quedar exactamente igual que antes del guardado, incluidos los distritos retirados.

### J · Lo que esta ficha no cambia

- **R49** — El sistema NO DEBE ofrecer renombrar una provincia, un cantón ni un distrito.

- **R50** — El sistema NO DEBE escribir en `zona_distrito` como consecuencia de dar de alta,
  desactivar o reactivar un nodo.

---

## 3. Trazabilidad `R<n>` → test

Nombres propuestos; el implementer confirma los definitivos en `progress/impl_374.md`, que es donde
`docs/specs.md` sitúa el mapa. **Todo lo que es un `WHERE` va a integración contra Postgres**: en
este repo está medido cuatro veces que una mutación de un `WHERE` pasa en verde con dobles.

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R1 | «tras la migración las tres tablas tienen `activo` NOT NULL DEFAULT true y las 494+84+7 filas previas quedan en `true`» | `tests/integration/db/geografia-activo-migration.test.ts` |
| R2 | «el `down.sql` deja las tres tablas sin la columna y con el mismo número de filas que antes del `up`» | `tests/integration/db/geografia-activo-migration.test.ts` |
| R3 | «insertar una provincia repetida, un cantón repetido dentro de su provincia y un distrito repetido dentro de su cantón fallan con violación de unicidad» + «el mismo nombre bajo otro padre entra» | `tests/integration/db/geografia-unicidad.test.ts` |
| R4 | «`pg_indexes` no lista ningún índice cuya definición sea solo `(activo)` en las tres tablas» | `tests/integration/db/geografia-activo-migration.test.ts` |
| R5 | «ningún archivo de `lib/` ejecuta `delete`/`deleteMany` sobre `provincia`, `canton` ni `distrito`», con contraprueba sobre un cuerpo mutado en memoria | `tests/unit/guards/geografia-sin-borrado-fisico.guardia.test.ts` |
| R6 | «con todo activo, `list*Lite`, el árbol, `findDistritosByCantonIds` y los conteos devuelven los mismos ids que sin la marca» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R7 | «distrito activo bajo cantón inactivo → no disponible» y las 8 combinaciones de los tres flags | `tests/unit/repositories/geografia-activa.test.ts` |
| R8 | «desactivar un cantón deja los `activo` de sus distritos intactos» (se leen antes y después) | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R9 | «con un distrito ya inactivo por su cuenta: desactivar su cantón y reactivarlo devuelve exactamente los flags previos, distrito a distrito» | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R10 | «el árbol devuelve el distrito activo bajo cantón inactivo y lo marca heredado; ninguna consulta lo corrige» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R11 | «toda lectura que recorta por disponibilidad usa el fragmento compartido», con contraprueba sobre una copia mutada | `tests/unit/guards/geografia-predicado-unico.guardia.test.ts` |
| R12 | «maestro crea provincia, cantón y distrito y las tres filas existen bajo su padre» | `tests/integration/db/geografia-alta.test.ts` |
| R13 | «el nodo creado nace con `activo = true`» | `tests/integration/db/geografia-alta.test.ts` |
| R14 | «alta con `provinciaId`/`cantonId` inexistente → `not_found` y cero filas creadas» | `tests/unit/services/geografia-service.test.ts` |
| R15 | «alta de un distrito bajo un cantón inactivo → `ok`, con flag propio activo y disponibilidad efectiva falsa» | `tests/integration/db/geografia-alta.test.ts` |
| R16 | «`"  San   José  "` se persiste como `"San José"`, con sus mayúsculas y su acento» | `tests/unit/types/geografia-nodo.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R17 | «con `San José` ya existente, `san jose`, `SAN JOSE` y `San  José` dan `conflict` y no crean fila», incluido el caso del hermano **inactivo** | `tests/unit/services/geografia-service.test.ts` · `tests/integration/db/geografia-alta.test.ts` |
| R18 | «si el service deja pasar el duplicado, el UNIQUE de la base lo convierte en `conflict` y no en error crudo» (se llama al repositorio dos veces sin comprobación previa) | `tests/integration/db/geografia-alta.test.ts` |
| R19 | «`Buenos Aires` puede existir a la vez como cantón de Puntarenas y como distrito de Palmares, y dos cantones homónimos en provincias distintas entran» | `tests/integration/db/geografia-unicidad.test.ts` |
| R20 | «maestro desactiva y reactiva en los tres niveles» | `tests/integration/db/geografia-cascada-reversible.test.ts` |
| R21 | «desactivar lo ya inactivo y activar lo ya activo devuelven `ok` y dejan el mismo estado» | `tests/unit/services/geografia-service.test.ts` |
| R22 | «id inexistente → `not_found`, sin escrituras» | `tests/unit/services/geografia-service.test.ts` |
| R23 | «sin sesión → `unauthenticated` sin instanciar el service» (una por acción) | `tests/unit/actions/geografia-action.test.ts` |
| R24 | «rol ≠ `maestro` → `forbidden` sin llamar al repositorio» (una por operación) | `tests/unit/services/geografia-service.test.ts` |
| R25 | «nivel desconocido, padre ausente, nombre corto y clave desconocida → `validation_error` sin tocar el service» | `tests/unit/actions/geografia-action.test.ts` |
| R26 | «el árbol trae el distrito inactivo y su `activo` en los tres niveles» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R27 | «un distrito con 0 zonas y otro con 2 salen los dos como sin zona utilizable; el de 1 sale con su zona» | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R28 | «`listProvinciasLite`/`listCantonesLite`/`listDistritosLite` devuelven el nodo retirado, con `disponible: false`», y una mutación que meta el filtro en el `WHERE` pone el test rojo | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R29 | «los tres desplegables de la ventana de corrección no ofrecen los nodos con `disponible: false` y sí los demás» | `tests/unit/components/corregir-ubicacion-inactivos.test.tsx` |
| R30 | «corregir hacia un distrito retirado → rechazo con el motivo de retirada, distinto del de inexistente, y sin escritura» | `tests/unit/services/corregir-datos-cliente-geo-retirada.test.ts` |
| R31 | «`findDistritosByCantonIds` y `findDistritoParaCorreccion` devuelven el distrito retirado con su disponibilidad», con mutación del `WHERE` que lo pone rojo | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R32 | «terna con provincia / cantón / distrito retirado → error de fila con el mensaje de retirada, y NO con `no encontrado` ni `ambiguo`» | `tests/unit/services/geo-resolucion-retirados.test.ts` |
| R33 | «con los tres niveles retirados a la vez, el mensaje es el de la provincia»; y los dos casos restantes de la precedencia | `tests/unit/services/geo-resolucion-retirados.test.ts` |
| R34 | «un distrito con zona pero retirado deja de contar en `distritosConCobertura`», con contraprueba antes de retirarlo | `tests/integration/db/geografia-catalogo-activo.test.ts` |
| R35 | «una orden de un distrito retirado sigue en el listado y sigue saliendo al filtrar por su `distritoId`» | `tests/integration/db/geografia-historico-intacto.test.ts` |
| R36 | «un lote de 2 filas con una retirada devuelve 200, una cotizada y una en `errores`» | `tests/integration/cotizacion-api-key.test.ts` |
| R37 | «los dos artefactos declaran el caso de fila retirada» + «existe la entrada fechada en `docs/api/CHANGELOG.md`» | `tests/unit/api/openapi-374-nodo-retirado.test.ts` |
| R38 | «la página niega el acceso a un rol que no es `maestro` y no pinta el árbol» | `tests/unit/components/geografia-admin-page.test.tsx` |
| R39 | «buscar `perez zeledon` encuentra `Pérez Zeledón`; `san  jose` encuentra `San José`» | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R40 | «un nodo con flag propio inactivo muestra el distintivo propio; uno inactivo por herencia muestra el heredado nombrando al ascendiente» | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R41 | «en el inactivo heredado el botón de activar está deshabilitado y su nombre accesible dice el motivo» | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R42 | «un distrito sin zona utilizable muestra su marca; uno con zona no la muestra» | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R43 | «el alta de cantón exige provincia y la de distrito exige cantón; la de provincia no exige padre» | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R44 | «desactivar abre confirmación y no llama a la acción» + «si deja una zona sin distritos disponibles, la confirmación la nombra y el botón de confirmar sigue habilitado» | `tests/unit/components/geografia-admin.ui.test.tsx` · `tests/unit/utils/zonas-sin-distritos.test.ts` |
| R45 | «cada desenlace muestra su propio mensaje y dispara una relectura del árbol» (6 casos) | `tests/unit/components/geografia-admin.ui.test.tsx` |
| R46 | «Configuración ofrece los seis `href` en orden, con `/configuracion/geografia` el último» + «el destino post-login de cada rol no cambia» | `tests/unit/auth/menu-visibility.test.ts` · `tests/unit/auth/destino-post-login.test.ts` |
| R47 | «el selector de Tarifas pinta el distrito retirado, marcado si venía en `initialSelected`, y su casilla responde al clic» | `tests/unit/components/geografia-selector-inactivos.test.tsx` |
| R48 | «guardar una zona sin tocar el selector deja `zona_distrito` con exactamente las mismas filas, incluida la del distrito retirado» | `tests/integration/db/zona-guardado-conserva-inactivos.test.ts` |
| R49 | «no existe ninguna acción, método de service ni método de repositorio que cambie el nombre de un nodo» | `tests/unit/guards/geografia-sin-renombrado.guardia.test.ts` |
| R50 | «tras un alta, una desactivación y una reactivación, `zona_distrito` tiene exactamente las mismas filas» | `tests/integration/db/geografia-cascada-reversible.test.ts` |

---

## 4. Fuera de alcance

Decidido por el humano el 2026-09-05. **No se amplía sin una ficha nueva.**

- **Renombrar** un nodo, y con él `codigo_dta` como clave estable. Es la ficha siguiente, y el
  motivo está medido: `scripts/seed-zonas.ts` resuelve el padre por nombre **exacto** y, si no lo
  encuentra, **crea** (`:109-140`). Renombrar sin clave estable haría que la próxima corrida del
  seed creara un duplicado **activo**, y a partir de ahí `resolveGeo` respondería
  `"distrito ambiguo en el canton"` a toda carga que lo mencione. Añadir y desactivar no corren ese
  riesgo: el seed no crea lo que ya existe (`findFirst` por nombre → lo encuentra → **no escribe**)
  y no toca el flag de nada.
- **Borrado físico** de cualquier nodo, en cualquier condición (R5).
- **Vetar** la desactivación del único distrito de una zona. Se avisa (R44) y no se bloquea.
- **Mover** un distrito de cantón o un cantón de provincia.
- **Rellenar** los 148 distritos sin zona, ni ofrecer asignar zona desde esta pantalla: la zona se
  administra en Tarifas y se seguirá administrando allí.
- **Reescribir** `actualizarDistritosEspeciales` (`lib/actions/geografia.ts:133-166`), que hoy va
  contra Prisma directo. Es una escritura del flujo de Tarifas, ya viva y probada; moverla no da
  nada a esta ficha y sí pone en riesgo algo que funciona.
- **Importar** una DTA completa desde un archivo. Aquí se dan de alta nodos de uno en uno.
- **Ocultar** del catálogo de filtros los nodos retirados (R28): es exactamente lo contrario de lo
  que hace falta, y §0.2 del `design.md` explica por qué esto no es la ficha 351.

---

## 5. Preguntas abiertas

No se inventa respuesta para ninguna. Las cuatro bloquean detalles acotados, no la ficha entera.

1. **¿El alta y la desactivación se registran en `historial_accion`?** El catálogo de acciones de
   la ficha 362 audita hoy lo **destructivo o irreversible** (`vehiculo_borrado`, `zona_borrada`,
   `tarifa_borrada`, `plantilla_eliminada`) y **no** audita el alta ni el renombrado de vehículos
   (`lib/types/historial-accion.ts:106-109`), que es el precedente más cercano a esta pantalla.
   Siguiendo ese precedente, esta ficha **no** registra acciones, y verificado el 2026-09-05 eso no
   pone roja ninguna guardia: `historial-accion-escrituras-cubiertas.guardia.test.ts` recorre el
   **enum** y exige productor para cada valor, no lo contrario. **Pero** desactivar un distrito
   tiene consecuencia comercial (deja de poder cargarse), y eso lo acerca más a `zona_borrada` que
   a `vehiculo_creado`. Si la respuesta es «sí», el coste es aditivo: un `ALTER TYPE … ADD VALUE`
   por tipo nuevo, sus entradas de catálogo y de censo, y `appendAccion` dentro de la transacción.
2. **¿La pantalla ofrece un filtro «ver solo los retirados»?** Con 494 distritos y unos pocos
   inactivos, encontrarlos exige recorrer el árbol o saber su nombre. No está pedido y no se
   inventa.
3. **¿Qué pasa con las órdenes VIVAS de un distrito que se retira?** R35 fija que el histórico se
   sigue viendo y filtrando, y esta ficha no las toca. Queda por decidir si la confirmación de R44
   debe además decir cuántas órdenes **sin entregar** hay en ese distrito. Es una consulta más y una
   decisión de producto.
4. **¿Hace falta un aviso cuando se retira un nodo que hoy tiene cobertura?** R44 avisa por zonas
   que se quedan sin distritos. No cubre el caso «este distrito tiene zona y se está retirando»,
   que quizá merezca su propia línea en la confirmación.
