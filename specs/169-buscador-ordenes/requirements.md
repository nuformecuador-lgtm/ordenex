# Feature 169 — Buscador de texto en el listado de órdenes · requirements.md

> Zona: fullstack · Complejidad: high · `depends_on: 144` · Rama: `feature/169-buscador-ordenes`
> Notación EARS estricta (`docs/specs.md`). Cada `R<n>` es testeable y **sin detalle de
> implementación** (el CÓMO va en `design.md`).
> La feature **145** depende de ésta: hereda el patrón ya medido, no lo reinventa por tabla.

## Alcance

Un solo campo de texto en `/ordenes` que encuentra una orden por **número de guía**,
**número de remisión**, **teléfono del destinatario** o **nombre del destinatario**,
resuelto **en el servidor** (la tabla está paginada server-side: filtrar en el cliente
solo filtraría la página visible).

**Decisiones del humano que este spec NO reabre:**

1. **Campos buscables: exactamente cuatro** — `num_guia`, `num_remision`, `telefono_dest`,
   `destinatario`. Los cuatro son columnas de `orden`. **Fuera**: dirección, producto y
   nombre de tienda (esta última metía un JOIN).
2. **Superficie: solo `/ordenes`.** El rollout al resto de tablas es la feature 145.
3. **Volumen de diseño: decenas de miles de órdenes**, no las pocas de hoy.
4. **Mínimo de 3 caracteres** y espera antes de consultar (el usuario teclea, no dispara
   una consulta por tecla).

---

## Contexto verificado en el repo (leído, no supuesto)

- **Transporte.** `listarOrdenes(input)` (`lib/actions/ordenes.ts`) valida con
  `listarOrdenesSchema` → `filter: ordenFilterSchema.optional()`. `ordenFilterSchema` es
  `.strict()` y hoy admite **10 claves**: `status_id`, los cinco catálogos
  (`zona_id`/`tienda_id`/`provincia_id`/`canton_id`/`distrito_id`), las tres temporales
  (`created_preset`/`created_desde`/`created_hasta`) y el predicado compuesto
  `reasignables`. **Ninguna es de texto libre.**
- **Traducción.** `OrdenService.construirWhere` mapea claves públicas a columnas con
  `FILTER_TO_COLUMN` y escribe el **acotamiento por rol AL FINAL**, de modo que pise
  cualquier filtro. `listar` y `listarCompleto` (descarga de la 151) **comparten** ese
  método: lo que se añada al `where` afecta a los dos.
- **Repositorio.** `OrdenRepository.list` ejecuta
  **`Promise.all([findMany, count])`** — *corrección a la dirección recibida, que hablaba
  de `$transaction([...])`: no hay transacción, son dos consultas en paralelo con el
  MISMO objeto `where`*. El `count` es exacto en cada página.
- **Modelo.** `db/schema.prisma`, `model Orden`: `numGuia Int? @unique`,
  `numRemision String @unique`, `destinatario String`, `telefonoDest String`. Índices:
  btree de FKs + los cuatro de catálogo de `20260728120000_orden_indices_filtros`.
  **Ninguno sirve para una coincidencia parcial en medio de una cadena.**
- **Extensiones.** `db/schema.prisma` no declara `previewFeatures` ni `extensions`, y
  **ninguna migración del repo ejecuta `CREATE EXTENSION`** (verificado por búsqueda en
  `db/`): esta feature sería la primera.
- **Roles que alcanzan este listado.** `OrdenService` tiene
  `KNOWN_ROLES = {maestro, admin, adminTienda, mensajero}`; cualquier otro rol →
  `forbidden`. `app/(app)/ordenes/page.tsx` manda `mensajero` y `adminSatelite` a
  `notFound()`. *Corrección a la dirección recibida: `adminSatelite` **no** lista órdenes
  aquí acotado por zona — no lista aquí en absoluto.* Los acotamientos reales de esta
  superficie son: `adminTienda` → sus órdenes; `mensajero` → sus asignadas.
- **Barra de filtros.** `components/shared/FilterComponent.tsx` (feature 144) orquesta N
  filtros declarados por props, es dueño del estado agregado, **ya trae un *debounce* de
  emisión de 500 ms** (`DEBOUNCE_MS_DEFAULT`) y soporta `kind`
  `multi`/`single`/`dateRange`/`boolean`. Su salida es `Record<string, string[]>`.
  `app/(app)/ordenes/_components/ordenes-filtros-def.ts` declara los siete filtros de
  órdenes y `seleccion-a-filter.ts` los traduce al `filter`.
- **Caché y paginación.** `serializar-filtro.ts` deriva la key SWR del filtro; al cambiar
  esa key, `OrdenesModule` vuelve a página 1 y limpia la selección de filas.
- **`components/shared/TableFilters.tsx` no tiene ningún consumidor** (búsqueda por
  ficheros: solo aparece en el propio archivo, en `feature_list.json` y en el spec de la
  144). No se usa aquí.
- **Precedente de UX, no de implementación.** El buscador del mensajero (feature 114,
  `mis-asignaciones-buscador.ts`) filtra **en cliente** sobre lo ya cargado, usa
  exactamente estos cuatro campos, normaliza con `normalizeName` (NFD + sin diacríticos +
  minúsculas + trim + colapso de espacios) y reintenta el teléfono en solo-dígitos. Sirve
  como referencia de comportamiento esperado; **no** sirve para una tabla paginada.

---

# Bloque A — Contrato de búsqueda (servidor)

**R1.** El sistema DEBE aceptar en el `filter` de `listarOrdenes` una clave **opcional** de
búsqueda de texto libre, adicional a las claves ya admitidas.

**R2.** El sistema DEBE resolver el término contra **exactamente cuatro datos de la orden**
—número de guía, número de remisión, teléfono del destinatario y nombre del destinatario—
y NO DEBE hacer coincidir el término contra ningún otro dato (en particular: dirección,
producto, notas ni el nombre de la tienda).

**R3.** SI el término, una vez recortados los espacios de los extremos, tiene **menos de 3
caracteres**, ENTONCES el sistema DEBE responder `validation_error` y NO DEBE ejecutar
ninguna consulta.

**R4.** SI el término supera la longitud máxima admitida, ENTONCES el sistema DEBE
responder `validation_error` y NO DEBE ejecutar ninguna consulta.

**R5.** El sistema DEBE encontrar una orden cuando el término coincide con un **fragmento
en cualquier posición** —principio, medio o final— de cualquiera de los cuatro datos
buscables.

**R6.** El sistema DEBE encontrar la orden **independientemente de mayúsculas y de
acentos**: un término sin tildes DEBE encontrar el dato con tildes, y un término con
tildes DEBE encontrar el dato sin tildes, en ambos sentidos y en ambos casos de caja.

**R7.** El sistema DEBE tratar como **texto literal** cualquier carácter del término que
tenga significado especial en el motor de coincidencia (comodines y escapes), de modo que
un término que los contenga NO DEBE ampliar el conjunto de resultados.

**R8.** El sistema DEBE tolerar espacios sobrantes dentro y en los extremos del término:
un término con espacios repetidos DEBE producir el mismo resultado que el mismo término
con espacios simples.

**R9.** CUANDO el término está formado **solo por dígitos** y corresponde a un número de
guía existente dentro del alcance del actor y del resto de filtros vigentes, el sistema
DEBE devolver esa orden y NO DEBE devolver otras órdenes que solo contengan ese fragmento
en otros datos.

**R10.** SI el término está formado solo por dígitos y **no** corresponde a ningún número
de guía dentro del alcance y filtros vigentes, ENTONCES el sistema DEBE resolverlo como
coincidencia parcial sobre los cuatro datos buscables (de modo que teclear los últimos
dígitos de un teléfono encuentre la orden).

**R11.** El criterio con el que se resuelve un término solo-dígitos (R9 frente a R10) DEBE
ser **independiente de la página solicitada**: la misma entrada DEBE resolverse igual
pidiendo la página 1 que pidiendo cualquier otra.

**R12.** SI el término solo-dígitos no es representable como número de guía (por exceder
el rango admitido por esa columna), ENTONCES el sistema DEBE resolverlo como coincidencia
parcial (R10) y NO DEBE fallar.

**R13.** CUANDO el término contiene solo dígitos y separadores habituales de teléfono, el
sistema DEBE encontrar la orden **con o sin esos separadores** en el dato almacenado.

**R14.** CUANDO el `filter` trae término de búsqueda junto a otros filtros, el sistema DEBE
devolver únicamente las órdenes que satisfacen **el término Y todos los demás filtros**
(conjunción), sin que ninguno anule al otro.

**R15.** El sistema DEBE calcular el total de resultados con **exactamente el mismo
criterio** que la página devuelta, de modo que la paginación sea coherente con la búsqueda
aplicada.

**R16.** La búsqueda NO DEBE alterar el **orden** del listado: el criterio de ordenación
vigente DEBE ser el mismo con término y sin término (no hay orden por relevancia).

**R17.** La búsqueda NO DEBE devolver órdenes borradas lógicamente.

**R18.** MIENTRAS no se proporcione término de búsqueda, el sistema DEBE producir
exactamente el mismo comportamiento, el mismo criterio de consulta y la misma entrada
enviada que antes de esta feature (sin regresión del contrato de `listarOrdenes`).

**R19.** SI el `filter` contiene una clave fuera de la lista blanca server-side, ENTONCES
el sistema DEBE seguir respondiendo `validation_error` sin ejecutar ninguna consulta
(la lista blanca crece en una clave; no se abre).

**R20.** La descarga del dataset completo DEBE aplicar el mismo término de búsqueda que el
listado en pantalla, de modo que lo descargado sea lo listado.

---

# Bloque B — Alcance por rol (fuga de datos)

**R21.** El sistema DEBE aplicar el término **después** —y nunca en lugar— del acotamiento
por rol vigente: el término solo puede **estrechar** el conjunto de resultados, nunca
ampliarlo.

**R22.** MIENTRAS el actor sea `adminTienda`, el sistema DEBE devolver únicamente órdenes
de su propia tienda, aunque el término coincida exactamente con datos de órdenes de otras
tiendas; y el total devuelto DEBE reflejar ese mismo acotamiento.

**R23.** MIENTRAS el actor sea `mensajero`, el sistema DEBE devolver únicamente sus órdenes
asignadas, aunque el término coincida con datos de órdenes ajenas.

**R24.** SI quien busca tiene un rol que este listado no reconoce (p. ej. `adminSatelite`),
ENTONCES el sistema DEBE responder `forbidden` y NO DEBE devolver datos ni conteos.

**R25.** SI quien busca no tiene sesión válida, ENTONCES el sistema DEBE responder
`unauthenticated` y NO DEBE devolver datos ni conteos.

---

# Bloque C — Datos derivados y migración

**R26.** El sistema DEBE mantener el dato que hace posible la búsqueda **sincronizado
automáticamente** con los cuatro campos buscables: CUANDO se crea una orden, DEBE poder
encontrarse por sus cuatro datos sin ninguna acción adicional; y CUANDO se modifica uno de
esos cuatro campos, la orden DEBE encontrarse por el valor nuevo y DEBE dejar de
encontrarse por el anterior.

**R27.** Ninguna ruta de escritura de órdenes —alta manual, carga masiva por sesión, carga
por API key y actualización— DEBE escribir el dato derivado, y todas DEBEN seguir
funcionando sin cambios observables.

**R28.** El dato derivado NO DEBE exponerse en ningún DTO, respuesta de Server Action,
descarga ni respuesta de API: la superficie de datos visible NO DEBE cambiar.

**R29.** La migración DEBE ser reversible: su reverso DEBE deshacer en orden inverso lo que
la migración crea, DEBE poder ejecutarse dos veces sin fallar y, tras ejecutarlo, el
listado sin término de búsqueda DEBE seguir funcionando.

**R30.** El esquema declarado y el SQL aplicado NO DEBEN divergir: generar una migración
nueva sobre el árbol ya migrado NO DEBE proponer ninguna sentencia sobre los objetos que
crea esta feature.

**R31.** MIENTRAS haya un término de búsqueda válido, la consulta DEBE resolverse mediante
un índice sobre la tabla de órdenes y NO DEBE recorrerla entera.

---

# Bloque D — Interfaz

**R32.** La superficie de órdenes DEBE ofrecer **un** campo de texto de búsqueda como
**primer control** de su barra de filtros.

**R33.** El campo de búsqueda DEBE declararse sobre el componente de filtros genérico ya
existente, sin lógica de dominio dentro del componente y sin duplicar la barra.

**R34.** CUANDO el usuario teclea, el sistema DEBE **aplazar** la consulta hasta que deje
de escribir, de modo que una ráfaga de pulsaciones produzca **una sola** consulta.

**R35.** MIENTRAS el término tenga menos de 3 caracteres y no esté vacío, el sistema NO
DEBE enviar la búsqueda al servidor y NO DEBE mostrar un error de validación; y DEBE
indicar al usuario que hacen falta al menos 3 caracteres.

**R36.** CUANDO el usuario vacía el campo, el sistema DEBE volver al listado sin búsqueda
(la clave DEBE desaparecer de la consulta).

**R37.** El campo de búsqueda DEBE poder limpiarse individualmente y DEBE quedar vacío con
la acción "Limpiar todo" de la barra.

**R38.** CUANDO cambia el término aplicado, el listado DEBE volver a la página 1 y limpiar
la selección de filas, igual que ante cualquier otro filtro.

**R39.** El término aplicado DEBE formar parte de la identidad de caché del listado, de
modo que dos términos distintos NO compartan resultados y el mismo término no provoque una
consulta nueva en cada render.

**R40.** SI hay un término aplicado y la búsqueda no devuelve resultados, ENTONCES la tabla
DEBE decir que no hay coincidencias **para ese término** y ofrecer limpiar la búsqueda, en
vez del mensaje genérico de listado vacío.

**R41.** El campo de búsqueda DEBE exponer un nombre accesible propio y su estado (texto
introducido, aviso de mínimo) DEBE ser legible por lector de pantalla.

**R42.** El comportamiento observable de cualquier otra tabla o superficie de la aplicación
—en particular el buscador de cliente del mensajero (feature 114) y el resto de filtros de
la 144— NO DEBE cambiar.

---

## Trazabilidad

Cada `R<n>` se mapea a **al menos un test concreto** en la tabla R→test de `tasks.md`; el
implementer la reproduce en `progress/impl_169-buscador-ordenes.md` y el reviewer rechaza
si falta alguno. Reglas duras de esa tabla:

- **R31** se verifica con el **plan de ejecución real** (integración contra Postgres), no
  con una aserción de código.
- **R26/R27/R29/R30** se verifican contra la migración aplicada, no solo por regex del SQL.
- **R33/R41** se testean con filtros de fantasía: el control de texto genérico NO puede
  importar dominio (misma regla que el bloque A de la 144).

---

## Preguntas abiertas

**P1 — ¿Puede un `num_guia` real tener menos de 3 dígitos?** El mínimo de 3 caracteres (R3)
es decisión cerrada del humano, pero `num_guia` lo genera `siguiente_num_guia()`
(permutación multiplicativa sobre una secuencia, migración `20260720160000`) y **el rango
de valores que produce no está documentado en el repo**. Si existieran guías de 1–2
dígitos, serían inalcanzables desde el buscador. *Default si no hay respuesta:* se mantiene
el mínimo de 3 y se deja anotado como limitación conocida.

**P2 — ¿`pg_trgm` ya está instalada en las bases de preview y producción, y en qué
esquema?** Ninguna migración del repo crea extensiones, pero Supabase preinstala varias en
el esquema `extensions` y no puedo consultar esas bases desde aquí. La respuesta cambia
**una línea** de la migración (ver `design.md §2.3`) y debe verificarse **antes** de
aplicar en cada base. *Default:* la migración crea la extensión en `extensions` si no
existe y falla de forma ruidosa —nunca silenciosa— si ya existe en otro esquema.

**P3 — Término solo-dígitos que es a la vez una guía y un fragmento de teléfono: ¿qué
espera ver el humano?** Este spec decide **la guía exacta y solo la guía** (R9), porque es
la lectura operativa de "buscar una guía" y es la consulta más barata. La alternativa
—devolver la unión de guía exacta más coincidencias parciales— es defendible y cuesta lo
mismo de implementar. *Default:* R9 tal cual está escrito.

**P4 — ¿Cuántas órdenes hay HOY en producción?** El argumento de "indexar ahora que la
tabla es pequeña" (`design.md §2.2`) depende de ese número, que no está en el repo. No
bloquea el spec, pero sí decide si la migración necesita ventana de mantenimiento.
*Default:* se mide con un conteo antes de aplicar (task T0.1) y, si supera el umbral
declarado en el diseño, se pide ventana.
