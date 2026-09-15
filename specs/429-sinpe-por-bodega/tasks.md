# Ficha 429 — desglose

**Se implementa SOLA.** Lleva migración, y una migración en una base local compartida pone rojo el
gate de las demás fichas en curso. Secuencia: **backend → frontend**, con la puerta de `/design` en
medio (T17).

**Leyenda:** `[P]` = puede ir en paralelo con las tareas marcadas igual **dentro de su misma fase**.
Cada tarea trae su criterio de «hecho»: si no se puede comprobar, no está hecha.

---

## Fase 0 — la puerta que bloquea la migración

### T0 — Medir los dos valores de la siembra
**Depende de:** nada. **Bloquea:** T4, T15, T22.
Pedir al humano (Q1 de `requirements.md`) el `NEXT_PUBLIC_SINPE_NUMERO` y el
`NEXT_PUBLIC_SINPE_NOMBRE` vigentes en Vercel (entorno **Production**), y comprobar que el número
cumple `^[678][0-9]{7}$`.
**Hecho cuando:** los dos valores están anotados en `progress/impl_429.md`, con la comprobación del
formato escrita, y el humano ha autorizado escribirlos como literales en `migration.sql`.
**Si el número NO cumple el formato:** se para y se pregunta. Sembrar un número que el `CHECK`
rechaza revienta la migración en producción; relajar el `CHECK` para que pase es tirar D5 a la basura.

---

## Fase 1 — módulos puros (backend)

### T1 `[P]` — El validador del SINPE de Costa Rica
**Depende de:** nada.
`lib/utils/sinpe-cr.ts`: normalización (espacios, guiones, prefijo `+506`) y predicado de 8 dígitos
que empiezan por 6, 7 u 8. Más el `sinpeNumeroSchema` de zod que lo usa. Módulo puro, sin
`process.env` ni Prisma.
**Hecho cuando:** `tests/unit/utils/sinpe-cr.test.ts` pasa con la tabla de casos de R7/R9
—`61234567`, `71234567`, `81234567` válidos; `12345678`, `9123456`, `812345678`, `8123456a`, `""`,
`"   "` inválidos; `"8888 1111"`, `"8888-1111"`, `"+506 88881111"` normalizan a `88881111`— y la
tabla está exportada para que la reutilice el test contra Postgres de T4.

### T2 `[P]` — El resolvedor de bodega
**Depende de:** nada.
`lib/utils/sinpe-bodega.ts` con `resolverSinpeBodega` (design §2). Sin ramas de más: mensajero, y si
no, orden.
**Hecho cuando:** `tests/unit/utils/resolver-sinpe.test.ts` cubre los tres casos de R13/R15 (con
mensajero, sin mensajero, mensajero sin zona) y afirma que el resultado **nunca** es cadena vacía.

---

## Fase 2 — base de datos

### T3 — Migración A: el valor nuevo del enum
**Depende de:** nada. **Antes que T4** (orden de timestamps).
`db/migrations/<ts>_historial_accion_zona_sinpe/` con `migration.sql`
(`ALTER TYPE ... ADD VALUE IF NOT EXISTS 'zona_sinpe_cambiado';`) y su `down.sql`.
**El `down.sql` se escribe MIDIENDO** el catálogo de hoy con la consulta de `design.md §1.3`, no
copiando la lista de un `down` anterior — la del 2026-09-08 ya está rancia. Ningún `down.sql` previo
se toca.
**Hecho cuando:** `tests/integration/db/historial-accion-zona-sinpe-migration.test.ts` levanta el
estado previo ejecutando las migraciones **reales** anteriores (descubiertas leyendo `db/migrations`,
no escritas a mano), aplica el `up`, aplica el `down` y compara el enum **valor a valor y en orden**;
y comprueba que con una fila que use el valor nuevo el `down` **falla ruidosamente** sin borrarla.

### T4 — Migración B: las tres columnas, la siembra y los CHECK
**Depende de:** T0, T3.
`db/migrations/<ts>_zona_sinpe/` con el SQL de `design.md §1.3` en ese orden exacto (nullable →
`UPDATE` de siembra → `SET NOT NULL` → `CHECK`), y su `down.sql` (quita los dos `CHECK` y las tres
columnas).
**Hecho cuando:** `tests/integration/db/zona-sinpe-migration.test.ts` pasa contra Postgres real y
afirma: las tres columnas con su tipo y nulabilidad (R1/R4); `INSERT`/`UPDATE` con `NULL` rechazado
(R6); la tabla de casos de T1 corrida contra el `CHECK`, con los mismos veredictos (R7); `''` y
`'   '` rechazados (R8); tras el `up`, **cero** zonas con número distinto del sembrado y **cero** con
`sinpe_revisado_at` no nulo (R10); y que **no queda `DEFAULT`** en ninguna de las tres columnas.

### T5 — `db/schema.prisma` + cliente
**Depende de:** T4.
Los tres campos en `model Zona` con su TSDoc (por qué `NOT NULL`, por qué sin default, qué significa
`NULL` en la marca de revisión). `prisma migrate deploy` en local y `prisma generate`.
**Hecho cuando:** `prisma migrate status` dice que no hay drift y `pnpm run typecheck` ve los campos
nuevos. Si el dev server estaba levantado, se reinicia: un cliente Prisma rancio da 404 con el
armazón pintado.

### T6 — El catálogo de acciones
**Depende de:** T3.
`lib/types/historial-accion.ts`: el tipo nuevo en la lista (con el comentario del censo apuntando al
método productor), `CATEGORIA_POR_ACCION.zona_sinpe_cambiado = "mueve_dinero"`, y su etiqueta en
`ACCION_LABELS` —distinta de la de `zona_borrada`, `zona_central_cambiada` y
`zona_pago_mensajero_cambiado`—.
**Hecho cuando:** `tests/unit/historial-accion/catalogo-y-choke-point.test.ts` pasa con los conteos
actualizados (total del catálogo y reparto por categoría), el filtro del historial acepta el valor
nuevo, y el enum de la base coincide con el catálogo **contra `HISTORIAL_ACCION_TIPOS.length`**, nunca
contra un número congelado a mano.

---

## Fase 3 — escritura y permisos (backend)

### T7 — `ZonaRepository.guardarSinpe`
**Depende de:** T5, T6.
Una `$transaction`: `FOR UPDATE` de la fila → `UPDATE` de los dos valores + `sinpe_revisado_at =
now()` → si alguno cambió, `appendAccion(tx, ...)` con `etiquetaDeEntidad("zona", ...)`, `monto`
null, `valor_anterior`/`valor_nuevo` = los dos números, `lote_id` propio. **Con `tx`, nunca con
`this.prisma`.**
**Hecho cuando:** `tests/integration/db/zona-sinpe-rastro.test.ts` afirma R21 (1 fila, actor
congelado, etiqueta, los dos números), R23 (el titular no aparece en ninguna columna; `monto` null),
R24 (un guardado que revienta después del `UPDATE` deja 0 filas y el valor anterior intacto) y R25
(confirmar sin cambios → 0 filas y fecha de revisión puesta).

### T8 — La guardia del censo de historial
**Depende de:** T7.
Entrada nueva en `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`
declarando `ZonaRepository.guardarSinpe` como productor de `zona_sinpe_cambiado`, con su mutación
exigida (el `update` de las dos columnas).
**Hecho cuando:** la guardia pasa, y **falla** al comentar la llamada a `appendAccion` (comprobado a
mano y pegado en `progress/impl_429.md`). Recordatorio del límite conocido: esta guardia mide por
método, no por escritura.

### T9 — `SinpeBodegaService` + su interfaz
**Depende de:** T7.
`lib/interfaces/services/ISinpeBodegaService.ts` y `lib/services/SinpeBodegaService.ts`: listar,
guardar, confirmar. El permiso de R19/R20 se decide aquí, con la zona del actor **leída de la base**
por `usuarioId`; el `zonaId` del payload solo dice **qué** se quiere tocar, nunca **si** se puede.
**Hecho cuando:** `tests/unit/services/sinpe-bodega-service.test.ts` cubre la matriz rol × bodega de
R19 y el caso de R20 (payload con zona ajena → `forbidden`, sin escritura).

### T10 — Las Server Actions
**Depende de:** T9, T1.
`lib/actions/sinpe-bodega.ts` con las tres acciones de `design.md §4.1`, zod `.strict()` en el borde y
el mapeo a resultado discriminado (patrón de `lib/actions/zonas.ts`).
**Hecho cuando:** `tests/integration/actions/sinpe-bodega-action.test.ts` afirma R19 y R20 desde el
borde real, y que un payload con un campo desconocido devuelve `validation_error` (no un descarte
mudo).

### T11 — Crear y actualizar zona exigen el SINPE
**Depende de:** T5, T1.
`lib/types/zona.ts`: `sinpeNumero`/`sinpeNombre` en `zonaFieldsComunes`, con `sinpeNumeroSchema`.
`ZonaRepository.create` escribe los dos valores **y** `sinpe_revisado_at = now()` (R12: lo tecleó una
persona). `update` los deja como están —el SINPE se edita por su propia acción— salvo que el humano
pida lo contrario.
**Hecho cuando:** `tests/unit/services/zona-service.test.ts` y
`tests/integration/actions/zonas-action.test.ts` afirman R11 (falta cualquiera de los dos →
`validation_error`; número inválido → error **en el campo del número**) y
`tests/integration/db/zona-sinpe-revision.test.ts` afirma R12.

---

## Fase 4 — el valor llega a quien escribe el mensaje

### T12 — `negocioDesdeEnv()` desaparece
**Depende de:** T2.
Sustituirla por `negocioConSinpe(sinpe: SinpeBodega)` con el parámetro **obligatorio**. `urlBase`
sigue leyendo `NEXT_PUBLIC_SITE_URL`. `datosPlantillaDesdeOrdenEnvio` y `resolverValoresOrden` reciben
el par por parámetro (no se borran: hoy no tienen consumidor de producción y ese hallazgo se anota,
no se «arregla»).
**Hecho cuando:** `pnpm run typecheck` pasa y no queda ninguna lectura de `NEXT_PUBLIC_SINPE_*` en
`lib/`.

### T13 — `OrdenEnvioReader.findParaEnvio` resuelve por bodega
**Depende de:** T12, T5.
Añadir `sinpeNumero`/`sinpeNombre` a los dos `select` de zona que ese método **ya hace** (la de la
orden y la del mensajero asignado) y componer el `negocio` con `resolverSinpeBodega`.
**Hecho cuando:** `tests/unit/repositories/orden-envio-reader.test.ts` afirma R13 con un fixture donde
la zona del mensajero **no es** la de la orden, y R15 con los dos casos de respaldo. Sin consultas
nuevas: el test comprueba que el número de llamadas a Prisma no cambia.

### T14 — El par viaja en `MiAsignacionDTO`
**Depende de:** T13.
Los dos campos **requeridos** en `MiAsignacionDTO`. El typecheck enumera los productores (incluidos
`NovedadDTO` y `RecoleccionOrdenDTO`, que extienden el DTO) y cada uno los resuelve con la misma
función.
**Hecho cuando:** `pnpm run typecheck` pasa **sin volver opcional ningún campo** y la lista de
productores tocados está en `progress/impl_429.md`. Los fixtures que se rompan se arreglan aportando
el dato, nunca aflojando el tipo.

### T15 — La prueba de equivalencia
**Depende de:** T14, T0.
Test que renderiza `listo_para_entrega_mensajero` con una zona cuyo SINPE sean **los valores de
entorno de hoy**, por los dos caminos (servidor y dispositivo), y compara el texto con el que producía
el código anterior.
**Hecho cuando:** los dos textos son idénticos carácter a carácter (R16), en
`tests/unit/plantillas/preview-mismo-motor.test.ts`. Es la prueba de D8: si esto es verde, lo que ya
funcionaba sigue funcionando igual.

### T16 — Las guardias estáticas
**Depende de:** T12, T14.
Tres, cada una con su contraprueba (inyectar el defecto y comprobar que la guardia se pone roja):
1. `sinpe-sin-variables-de-entorno.guardia.test.ts` — la cadena `NEXT_PUBLIC_SINPE` no aparece en
   `lib/`, `app/`, `components/`, `hooks/`, `scripts/` ni `.env.example` (R17).
2. `sinpe-en-toda-superficie.guardia.test.ts` — todo constructor de `DatosPlantilla` aporta el par
   (R14).
3. `revision-sinpe-no-bloquea.guardia.test.ts` — el aviso se monta como hermano del contenido en el
   layout, nunca envolviéndolo, y ninguna ruta redirige por revisión pendiente (R28).
**Hecho cuando:** las tres pasan y las tres contrapruebas están ejecutadas y pegadas.

### T17 — Limpieza de la configuración
**Depende de:** T16.
Borrar las dos variables de `.env.example`; actualizar el `campo` documental de `{{sinpe}}` y
`{{sinpe_nombre}}` en `lib/types/plantilla-datos.ts` (`"env NEXT_PUBLIC_SINPE_NUMERO"` →
`"zona.sinpe_numero (bodega del mensajero)"`), y sus descripciones si mencionan «del negocio».
**Hecho cuando:** los tests del catálogo de plantillas pasan y la guardia 1 de T16 sigue verde.
⚠️ Tocar `.env.example` obliga al gate completo — que esta ficha ya necesita por la migración.

---

## Fase 5 — la revisión del primer inicio de sesión (backend + layout)

### T18 — El resolvedor de revisión pendiente
**Depende de:** T5.
`resolverRevisionSinpePendiente(actor)`: `null` para `mensajero`, `adminTienda`, cuentas de API y
`adminSatelite` sin zona; la zona propia para `adminSatelite`; la central para `admin`/`maestro`. Solo
devuelve algo si `sinpe_revisado_at IS NULL`.
**Hecho cuando:** `tests/unit/auth/revision-sinpe-pendiente.test.ts` cubre R26, R30 y R31, **incluido
el caso del `adminSatelite` sin zona** (devuelve `null`, no lanza), y afirma que para los roles sin
permiso **no se emite ninguna consulta**.

### T19 — Cableado en el layout
**Depende de:** T18.
Tercera lectura en el `Promise.all` de `app/(app)/layout.tsx`, solo para los tres roles que pueden
editar. Montaje del componente como **hermano** de `{children}`, al lado de `PushReactivacion`.
**Hecho cuando:** la guardia 3 de T16 pasa y el layout no añade latencia a `mensajero`/`adminTienda`
(se afirma que para ellos la tercera promesa no se crea).

---

## Fase 6 — pantalla (después de `/design`)

### T20 — Puerta de `/design`
**Depende de:** T19.
Pasar a `/design` **el qué**, no el cómo: (a) el aviso de `design.md §6.2` con sus cuatro
comportamientos; (b) la pantalla de `design.md §6.3` con sus dos vistas (una ficha para
`adminSatelite`, ocho para `admin`/`maestro`, con marca visible de «nunca revisada»); (c) el aviso de
que el ítem de menú va **al final** y por qué.
**Hecho cuando:** `/design` devuelve la propuesta visual y el humano la aprueba. **Nada de T21/T22 se
escribe antes.**

### T21 — La pantalla
**Depende de:** T20, T10.
Ruta `app/(app)/configuracion/sinpe/page.tsx` (Server Component con gate por la MISMA constante de
roles que el menú) + componentes cliente. Datos por props desde el servidor, nunca fetch desde el
cliente.
**Hecho cuando:** los tests de componente afirman que `adminSatelite` ve una ficha y `maestro` ocho,
que las no revisadas están marcadas, y que un guardado con número inválido pinta el error **junto al
campo del número**, no como un toast genérico.

### T22 — El aviso del primer login
**Depende de:** T20, T19, T10.
`RevisionSinpeBodega`: enseña, confirma, corrige en el sitio, se cierra sin confirmar, y no reaparece
hasta el siguiente inicio de sesión.
**Hecho cuando:** `tests/components/RevisionSinpeBodega.test.tsx` cubre R26, R27, R28 y R29,
incluyendo que cerrarlo **no** marca la bodega como revisada.

### T23 — El ítem de menú
**Depende de:** T21.
Entrada nueva en `SIDEBAR_ITEMS`, **al final**, con `roles` apuntando a una constante compartida con
el gate de la página.
**Hecho cuando:** `tests/unit/auth/destino-post-login.test.ts` sigue verde **sin tocar su `toEqual`**,
y un test nuevo afirma que el aterrizaje post-login de los cinco roles es el mismo antes y después.

---

## Fase 7 — verificación y cierre

### T24 — Gate completo, con base
**Depende de:** todo lo anterior.
`DATABASE_URL` exportada y `./init.sh` completo, con `INIT_EXIT=$?` escrito **dentro** del log (un
`echo` posterior se come el código de salida). Sin canalizar por `tail`: trunca el fichero en origen
y el rojo se queda sin nombre.
**Hecho cuando:** el veredicto contra `tests/baseline-rojos.json` es verde **y** el número de
`skipped` está mirado y explicado. Un «init OK» con 147 archivos de integración saltados no vale para
esta ficha: los `CHECK` viven justo ahí.

### T25 — Las tres mutaciones
**Depende de:** T24.
(a) `CHECK` a `^[0-9]{8}$`; (b) el resolvedor devuelve siempre la zona de la orden; (c) `appendAccion`
recibe `this.prisma` en vez de `tx`. Cada una tiene que poner algo rojo.
**Hecho cuando:** las tres salidas rojas están pegadas en `progress/impl_429.md`, con el nombre del
test que cayó. Sin salida pegada, la mutación no se ha corrido.

### T26 — Informe y commit
**Depende de:** T25.
`progress/impl_429.md` con el mapa `R<n> → test` completo (31 filas), los dos valores de la siembra,
la lista de productores del DTO tocados y las evidencias de T8, T16 y T25.
**Hecho cuando:** el archivo está **commiteado** y el blob verificado en la rama (`git show
HEAD:progress/impl_429.md`). Un informe que solo existe en disco se lo lleva el primer `checkout`.

---

## Fase 8 — después del despliegue (no lo hace el implementer)

### T27 — Medir producción en solo lectura
**Depende de:** la migración aplicada en producción.
Las dos consultas de `design.md §8.5` por el MCP de Supabase.
**Hecho cuando:** salen 8 filas, todas con el número de hoy y todas con `sinpe_revisado_at` en `NULL`,
y el resultado está escrito. Si sale otra cosa, la release se para.

### T28 — Retirar las variables de Vercel
**Depende de:** T27 y de que el despliegue lleve unos días estable.
Borrar `NEXT_PUBLIC_SINPE_NUMERO` y `NEXT_PUBLIC_SINPE_NOMBRE` del proyecto **`ordenex`** (no
`ordenex-app`, que es otro repo), en **los dos entornos**, Production y Preview.
**Hecho cuando:** ya no aparecen en el panel. Mientras sigan ahí no hacen daño —no las lee nadie—,
pero dejarlas invita a que alguien las «actualice» creyendo que sirven para algo.

### T29 — Ver la aplicación
**Depende de:** T28.
Entrar como `adminSatelite` de una bodega no revisada y como `admin`, y comprobar con los ojos: sale
el aviso, se puede corregir, se puede cerrar, no bloquea nada, y al volver a entrar reaparece; una vez
confirmado, no vuelve.
**Hecho cuando:** los seis gestos están comprobados. La suite no ve lo que ve una persona mirando la
pantalla.
