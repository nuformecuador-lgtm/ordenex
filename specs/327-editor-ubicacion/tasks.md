# Ficha 327 — Tareas

Convenciones: `[P]` = puede ir en paralelo con las demás `[P]` de su mismo bloque.
`⇐ Tn` = depende de esa tarea. Cada tarea dice su criterio de **Hecho**.
Los `(Rn)` al final son los requisitos que cubre. **Numeración vigente: R1–R36**
(`requirements.md`).

**Orden global obligatorio: backend → frontend.** Bloques A→D antes que E/F.
**No hay migraciones en esta ficha** (`design.md` §2.1): si alguien acaba escribiendo una, es señal
de que se salió del alcance — parar y volver al spec.
**Sigue sin haber rastro** (D3): ni nota, ni historial, ni tabla de auditoría. La **única** escritura
nueva fuera de la fila de la orden es el trabajo de re-geocodificación (R19), y su enmienda a
312/R14 está declarada en `requirements.md` §D6.
**Esta ficha pone rojas cuatro pruebas de la 312 a propósito** (`design.md` §8.2). Actualizarlas es
parte del trabajo; **borrarlas o relajarlas más allá de lo escrito, no**.

---

## Bloque 0 — Antes de tocar nada

- [x] **T0.1** Releer, con el archivo delante y sin fiarse de este spec:
      `lib/repositories/OrdenRepository.ts:1364-1443` (`update` y el **guard latente**, cuya frase
      clave está medida en `:1385`, no en `:1383`), `:1466-1488` (`corregirDatosCliente`),
      `:1553-1569` (`toUpdateData`, que **no** proyecta `direccion`), `:1614-1646`
      (`findDistritosByCantonIds` y el colapso de la N:M en `:1638`);
      `lib/interfaces/repositories/IOrdenRepository.ts:62-92`;
      `lib/types/orden.ts:39-53`;
      `lib/services/jobs/geocodificacion-encolado.ts:22-77`;
      `lib/utils/ingreso-ordenex.ts:121-139,240-271`;
      `lib/interfaces/repositories/ITarifaVigenteRepository.ts:82-94`;
      `db/schema.prisma:540-559,571-578,671,1979-2045`;
      `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts:56-68,258-274`.
      _Hecho:_ el censo de `design.md` §0 se confirma **o se corrige en el spec** antes de escribir
      una línea de código. Si algo no cuadra, se para y se pregunta.
- [x] **T0.2** `./init.sh --rapido` en verde sobre la rama recién creada, **antes** del primer
      cambio. _Hecho:_ log con `INIT_EXIT=$?` escrito **dentro** del propio log.
      _Anotado:_ el rápido **se negará solo** en cuanto la ficha toque `lib/types/` (A1/A2). Eso es
      un `fail`, no un aviso, y obliga al **gate completo** — es exactamente lo que le pasó a la 312
      (su `tasks.md` G5). Presupuestar el tiempo desde ahora.
      > **DESVIACIÓN, 2026-08-28.** Lo que se corrió como base **no fue `./init.sh --rapido`** sino
      > `pnpm run typecheck` (limpio) + los **6 archivos de test** que la ficha iba a tocar
      > (94/94 verdes). Motivo: el árbol venía **sin `.env`** —deuda conocida, registrada por la
      > chore/323— y sin él el gate sale rojo por `prisma migrate diff`, un rojo que no dice nada
      > del código. Se copió el `.env` del árbol principal (gitignored, **no commiteado**), con lo
      > que la base local quedó disponible y las suites contra Postgres corren de verdad. El gate
      > que vale es el COMPLETO de G2.

---

## Bloque A — Módulos puros y contratos (sin I/O)

- [x] **A1** `lib/types/orden.ts:39`: `actualizarOrdenSchema` gana
      `direccion: z.string().min(1).optional()`. **Y en el mismo commit**, reescribir los dos
      comentarios que quedan mintiendo (`design.md` §8.1):
      `OrdenRepository.ts:1384-1388` (la mitad de la frase que deja de ser cierta) y el docstring de
      `UpdateOrdenData.direccion` en `IOrdenRepository.ts:83-91` («Hoy NADIE lo informa»).
      _Hecho:_ `grep` que confirme **cero** consumidores de `actualizarOrdenSchema` fuera de
      `lib/types/correccion-datos-cliente.ts`; typecheck limpio; y los dos comentarios dicen que
      `update` sigue sin poder escribir la dirección **y quién sí puede**.
- [x] **A2 ⇐ A1** `lib/types/correccion-datos-cliente.ts`: `CAMPOS_CORREGIBLES` pasa a nueve,
      nace `CAMPOS_GEOGRAFIA`, y `corregirDatosClienteSchema` amplía su `.pick(...)` y suma los dos
      `refine` nuevos + la clave `confirmaCambioDeUbicacion` (`design.md` §9.1).
      **`zonaId` NO entra en el `.pick()`** y sigue cayendo por `.strict()` (R5).
      _Hecho:_ typecheck; el `refine` de «al menos un campo» **no** cuenta
      `confirmaCambioDeUbicacion` como campo a corregir.
- [x] **A3 ⇐ A2** Ampliar `tests/unit/types/correccion-datos-cliente-schema.test.ts`:
      - los **nueve** campos juntos ⇒ válido. **(R1)**
      - `zonaId`, `estatusId`, `tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`, `numRemision`,
        `mensajeroAsignadoId` ⇒ `validation_error`, uno por uno. **(R2)**
      - `provinciaId` solo, `provinciaId`+`cantonId`, `distritoId` solo ⇒ error; los tres ⇒ ok. **(R3)**
      - `distritoId: null` y `distritoId: ""` ⇒ error. **(R4)**
      - `direccion: ""` y `direccion: "   "` ⇒ error. **(R8)**
      - `peso: 0` y `peso: -1` ⇒ error; `peso: 0.5` ⇒ ok. **(R9)**
      - los casos de la 312 que **no cambian** siguen verdes (5.000 caracteres sin tope, `notas:
        null`, `ordenId` uuid).
      _Hecho:_ verde. La fila `direccion`/`peso` del `it.each` de rechazados (`:25-41`) se **mueve**
      a los aceptados; la de `zonaId` **se queda donde está**.
- [x] **A4 [P] ⇐ A2** `ICorregirDatosClienteService`: el desenlace
      `{ status: "confirmacion_requerida"; aviso }`, los tipos `AvisoCambioUbicacion` y
      `UbicacionConCostos` con su discriminante `tarifa: "resuelta" | "sin_tarifa"`, y el contrato de
      la lectura de precarga (`design.md` §9.2/§9.3).
      _Hecho:_ typecheck; ninguna rama del union queda sin usar; el docstring dice por qué
      `"sin_tarifa"` es un discriminante y no un `"0.00"`.

---

## Bloque B — Repositorio (backend, con Postgres)

- [x] **B1 ⇐ A2** `IOrdenRepository`:
      `CorregirDatosClienteData` gana **exactamente seis** claves (`direccion`, `provinciaId`,
      `cantonId`, `distritoId`, `zonaId`, `peso`); su docstring pasa a enumerar **las siete que
      siguen sin ser representables** (`design.md` §6).
      Nacen `OrdenParaCorreccionRow` + `findParaCorreccion` y `DistritoResueltoRow` +
      `findDistritoParaCorreccion` (`design.md` §9.4).
      _Hecho:_ typecheck; `montoCobrar` declarado como **STRING**, no `number`.
- [x] **B2 ⇐ B1** `OrdenRepository`: extraer el colapso de la N:M a `zonaUnicaDeDistrito(zonas)` y
      hacer que **lo usen las dos** lecturas (`findDistritosByCantonIds` y la nueva). Implementar
      `findParaCorreccion` (con `deletedAt: null` y `cierreDetalles: { take: 1 }`) y
      `findDistritoParaCorreccion` (con `canton.provinciaId` para R6).
      _Hecho:_ typecheck; `grep` que confirme que **no** se amplió `OrdenPrismaClient`; y que
      `findDistritosByCantonIds` sigue devolviendo lo mismo que antes (su suite existente, verde y
      **sin editar**).
- [x] **B3 ⇐ B1** Extraer el guard latente de `update` a `encolarSiCambiaDireccion(tx, id, dir)` y
      hacer que `update` **lo llame** en lugar del código inline (`design.md` §7.2).
      **Sin cambio de comportamiento**: la pre-lectura sigue siendo condicional y el encolado sigue
      exigiendo «informada Y distinta».
      _Hecho:_ `tests/integration/repositories/orden-geocode-enqueue.test.ts` verde **sin editarlo**;
      el comentario de la 91 se conserva (movido, no borrado) y dice ahora que el guard **ya tiene
      un llamador vivo**.
- [x] **B4 ⇐ B3** `corregirDatosCliente` pasa a `$transaction`: pre-lectura condicional de
      `direccion` → `updateMany` con el **mismo `WHERE` de siempre** → `count === 0` ⇒ `"conflict"`
      **sin encolar** → `count === 1` ⇒ `encolarSiCambiaDireccion` con el `tx`.
      El `data` se sigue proyectando **clave a clave** (nunca `...data`).
      _Hecho:_ typecheck; el método **conserva su nombre** (`async corregirDatosCliente(`), porque el
      recortador de la guardia de la 312 lo busca literalmente; `grep` que confirme **cero**
      call-sites de `new OrdenRepository(...)` tocados (el `jobRepo` ya venía con default).
- [x] **B5 ⇐ B4** Ampliar `tests/integration/db/corregir-datos-cliente.repo.test.ts` **contra
      Postgres**, cada caso con su fila sembrada:
      1. corregir dirección + los tres ids + peso en `en_reparto` ⇒ `"ok"`, y las columnas guardan
         lo enviado **recortado**. **(R1, R8)**
      2. `zona_id` de la fila queda **la derivada del distrito**, no la enviada ni la anterior. **(R15)**
      3. comparación fila-a-fila antes/después: cambian **solo** las columnas corregidas +
         `zona_id` + `updated_at`. **(R1)**
      4. `latitud`, `longitud`, `geocoded_at`, `geocode_precision`, `geocode_status` **sin
         cambiar**. **(R22)**
      5. `SELECT count(*)` sobre `orden_historial_estado`, `orden_nota` y `cierre_detail` de esa
         orden: **ninguno aumenta**, y las filas de `cierre_detail` existentes salen **idénticas**
         (comparación campo a campo, no solo el conteo). **(R17, R25)**
      6. los cuatro estados bloqueados y la orden con `deleted_at` ⇒ `"conflict"` y **cero**
         columnas cambiadas. **(R29)**
      7. `findDistritoParaCorreccion` sobre un distrito con **0** zonas y sobre uno con **2** ⇒
         `zonaId: null` en los dos; sobre uno con 1 ⇒ esa zona, con su `esCentral`. **(R7)**
      _Hecho:_ los 7 casos verdes y **cada uno matado con una mutación** antes de creerlo (quitar el
      `notIn` debe poner rojo el 6; escribir `zonaId` desde el input debe poner rojo el 2; que
      `zonaUnicaDeDistrito` devuelva `zonas[0]` debe poner rojo el 7). Un test de integración que
      pasa sin datos reporta `passed` sin comprobar nada.
- [x] **B6 ⇐ B4** `tests/integration/repositories/corregir-ubicacion-geocode.test.ts` — **la prueba
      de que el guard se activa de verdad**, que es lo que esta ficha no puede dar por hecho:
      - corregir la dirección ⇒ **una** fila `geocodificacion` encolada, con
        `dedupeKey = geocodificacion:<ordenId>:<hash8>` y `maxIntentos = 8`. **(R19)**
      - corregir **solo** el destinatario / solo el peso / solo la geografía ⇒ **cero** encolados. **(R20)**
      - mandar la MISMA dirección que ya tenía ⇒ **cero** encolados. **(R20)**
      - el `enqueue` recibe como 4.º argumento el **cliente transaccional** del writer; y con la
        escritura rechazada (`conflict`) **no** queda job. **(R21)**
      - el `payload` es **exactamente** `{ ordenId }`: ni la dirección, ni el destinatario. **(R23)**
      _Hecho:_ verde, y **con mutación**: si `corregirDatosCliente` deja de llamar al guard, el
      primer caso debe ponerse rojo; si encola fuera de la transacción, el cuarto.
      > **DESVIACIÓN DE RUTA, 2026-08-28.** El archivo vive en
      > **`tests/integration/db/corregir-ubicacion-geocode.test.ts`**, no en
      > `tests/integration/repositories/`. Motivo medido: en este repo
      > `tests/integration/repositories/` es la carpeta del **Prisma MOCKEADO**
      > (`orden-geocode-enqueue.test.ts` lo es), y con un doble no se puede demostrar lo que este
      > archivo existe para demostrar — que la **pre-lectura ve el valor anterior** y que la fila de
      > `jobs` **aparece de verdad**. `design.md` §7.4 exige «contra Postgres», y esa carpeta es
      > `tests/integration/db/`. Se cubren los cinco casos de la lista, más R22.
      > Medido: con el guard desconectado caen **2** (R19 y la identidad del `tx` de R21) y
      > `orden-geocode-enqueue` **sigue verde** — que es la prueba de que aquella suite nunca cubrió
      > este camino, que es justo el agujero que la ficha señalaba.

---

## Bloque C — Servicio

- [x] **C1 ⇐ A4, B1** `CorregirDatosClienteService`: la secuencia de la 312 se conserva entera
      (rol → orden → pertenencia → ventana) y se le añade, **después** del diff:
      resolución del distrito, comprobación de la cadena provincia→cantón→distrito (R6), derivación
      de la zona (R5/R7), gate de confirmación (R11/R15) y composición del aviso con
      `resolveTarifa` + `costosListadoOrden` (`design.md` §4.2).
      Dependencias por `Pick<…>`: repositorio de orden **y** de tarifas (`design.md` §9.5).
      _Hecho:_ se construye entero con dobles; no importa Prisma ni `next/headers`; `montoCobrar`
      viaja como STRING en todo el camino.
- [x] **C2 ⇐ C1** Ampliar `tests/unit/services/corregir-datos-cliente-service.test.ts`:
      - distrito que no pertenece al cantón, y cantón que no pertenece a la provincia ⇒
        `validation_error` en `distritoId`, **sin** llamar a la escritura. **(R6)**
      - distrito con 0 zonas y con 2 zonas ⇒ `validation_error` nombrando el motivo, sin escribir. **(R7)**
      - cambio de distrito **sin** `confirmaCambioDeUbicacion` ⇒ `confirmacion_requerida`,
        **cero llamadas de escritura**, y el aviso trae `actual` y `propuesta` con sus dos
        importes. **(R11)**
      - el mismo caso **con** la confirmación ⇒ escribe, y el `data` que llega al repositorio lleva
        la `zonaId` **derivada**, nunca una venida del input. **(R5, R15)**
      - corregir **solo** dirección / solo peso / solo los cuatro de la 312 ⇒ **no** hay gate. **(R11)**
      - `resolveTarifa` devuelve `null` ⇒ `tarifa: "sin_tarifa"` en la propuesta. **(R13)**
      - distrito marcado especial y tarifa sin pacto ⇒ `fleteOrigen: "especial_sin_pacto"`. **(R14)**
      - orden con una fila de cierre ⇒ `yaEnUnCierre: true`; sin ninguna ⇒ `false`. **(R16)**
      - nada que cambiar ⇒ `{ status: "ok", cambios: [] }` y cero escrituras. **(R10)**
      - los cuatro casos de rol/ventana de la 312, repetidos **con los campos nuevos** en la
        entrada: mismos desenlaces. **(R27)**
      - inexistente, borrada y ajena ⇒ **el mismo objeto** `{ status: "forbidden" }`. **(R30)**
      - el repositorio devuelve `"conflict"` ⇒ `{ status: "conflict" }`. **(R29)**
      - un input que traiga `rol`/`tiendaId` no cambia el desenlace: se decide con el **actor**. **(R28)**
      - la lectura de precarga con un rol denegado ⇒ `forbidden` y **cero** datos de la orden. **(R18)**
      _Hecho:_ todos verdes; ninguna aserción compara un texto contra la función que lo genera.
- [x] **C3 [P] ⇐ C1** Actualizar `tests/unit/guards/corregir-datos-sin-rastro.guardia.test.ts`
      (`design.md` §8.2), **sin relajarla**:
      - del bloque `CorregirDatosClienteData` se retira **solo** la cláusula `not.toContain
        ("direccion")`; se **añaden** `cobraComision`, `numGuia`, `numRemision` y
        `mensajeroAsignado` a las prohibidas, junto a `estatusId`, `tiendaId` y `montoCobrar`. **(R24)**
      - el censo `MODULOS_DE_LA_FICHA` gana `CorregirUbicacionAviso.tsx`. **(R26)**
      - los barridos de hilo de notas, historial y `console` siguen tal cual, y siguen verdes. **(R25, R26)**
      _Hecho:_ verde **con contraprueba** (inyectar `estatusId` en el tipo debe ponerlo rojo;
      inyectar un `console.log(orden.direccion)` en el aviso, también). Y `pnpm exec vitest run
      orden-nota-frontera` verde **sin haber tocado esa guardia**.
      > **MEDIA TAREA APLAZADA A E1, 2026-08-28.** El censo `MODULOS_DE_LA_FICHA` **NO** gana todavía
      > `CorregirUbicacionAviso.tsx`: ese archivo **aún no existe** (lo crea E1) y añadirlo ahora
      > pondría la guardia roja por su propio `existsSync`, que es como se acaba enseñando a ignorar
      > una guardia. Queda una **nota a pie del censo, dentro del array**, diciendo exactamente qué
      > entrada falta y por qué — para que el `frontend_dev` no pueda crear el componente sin verla.
      > La otra mitad de C3 (el bloque del tipo, con sus siete prohibidos, y el nuevo caso que mide
      > `zonaId` en el `.pick()`) **sí está hecha y matada con mutaciones**.
- [x] **C4 [P] ⇐ C1** `tests/unit/services/corregir-ubicacion-importes.test.ts` — **el dinero, sin
      aserciones contra su propia fuente**: se siembra una tarifa concreta (valores literales) y se
      comprueba que el aviso devuelve los importes **calculados a mano** en el propio test, no
      `costosListadoOrden(...)` invocada otra vez. Incluye al menos: GAM vs. no GAM (la zona elige
      columna), distrito especial con pacto y sin pacto, y una orden con `cobraComision: false`.
      _Hecho:_ verde; y **matado con una mutación**: cambiar `esCentral` o `esZonaEspecial` en el
      camino debe poner rojo al menos un caso. **(R12)**

---

## Bloque D — Server Action

- [x] **D1 ⇐ A2, C1** `lib/actions/corregir-datos-cliente.ts`: la acción existente pasa los nueve
      campos y `confirmaCambioDeUbicacion`; nace `obtenerUbicacionOrden` **en el mismo archivo**
      (para no crecer el censo de la guardia, `design.md` §9.3). El `buildService()` **pasa de
      verdad** el `TarifaVigenteRepository`, no solo lo importa.
      _Hecho:_ typecheck; y una prueba que construya el servicio por el composition root real y
      compruebe que la dependencia de tarifas **no llega `undefined`**.
- [x] **D2 ⇐ D1** Ampliar `tests/unit/actions/corregir-datos-cliente.action.test.ts`:
      - entrada con `zonaId` o con `estatusId` ⇒ `validation_error`, servicio no llamado. **(R2)**
      - entrada válida con los nueve ⇒ delega con el actor de la sesión. **(R28)**
      - sin sesión ⇒ `unauthenticated` **también** en `obtenerUbicacionOrden`, y el servicio no se
        construye. **(R18)**
      - `obtenerUbicacionOrden` sobre una orden ajena ⇒ el **mismo** objeto opaco que por rol. **(R30)**
      _Hecho:_ verdes con dobles inyectados por `deps`.

---

## Bloque E — Superficie `/ordenes` (frontend)

- [x] **E1 ⇐ D1** `app/(app)/ordenes/_components/CorregirUbicacionAviso.tsx`: la comparación
      (zona actual vs. propuesta, flete + IVA y comisión + IVA de cada una con `money()`), el texto
      de «sin tarifa configurada» **en lugar de un importe**, la marca de `especial_sin_pacto`, el
      aviso de cierre y el botón de confirmar.
      _Hecho:_ compila; **ni un cálculo**: el componente solo pinta lo que le llega. Ni un `console`.
- [x] **E2 ⇐ E1** `CorregirDatosClienteModal`: carga de precarga al abrir, los tres selectores
      encadenados por `padreId`, el campo de dirección (sin `maxLength`) y el de peso, y la segunda
      fase que monta `CorregirUbicacionAviso` cuando el servidor responde `confirmacion_requerida`.
      El aviso de etiqueta (312/R27) pasa a nombrar la **dirección**.
      _Hecho:_ typecheck; si la precarga falla, el modal sigue permitiendo corregir los cuatro campos
      de la 312 y lo dice; ningún texto promete un registro de la corrección.
- [x] **E3 ⇐ E2** ~~Cableado en `/ordenes`: pasar la geografía al modal por
      `OrdenesModule`/`OrdenesListado`.~~ **SUSTITUIDO, Y POR UNA MEDICIÓN (2026-08-29).** La
      ventana pide el catálogo ELLA MISMA, con SWR y una clave compartida
      (`CLAVE_GEOGRAFIA_CORRECCION`). El motivo está en F1: el cableado por props es imposible en la
      otra superficie sin poner roja una guardia, y dos caminos distintos para el mismo dato en una
      ventana COMPARTIDA es justo lo que R32 pide que no pase. `/ordenes` no se toca: ni una línea
      de `page.tsx`, `OrdenesListado` ni `OrdenesModule`.
      _Hecho:_ typecheck 0; **el disparador y la prop de rol no se tocan** (R27) — literalmente, esos
      tres archivos no aparecen en el diff.
- [x] **E4 ⇐ E3** Ampliar `tests/components/CorregirDatosCliente.ordenes.test.tsx`:
      - el modal abre con los **nueve** valores actuales dentro, incluidos provincia, cantón y
        distrito seleccionados. **(R31)**
      - elegir provincia recorta los cantones, y elegir cantón recorta los distritos. **(R31)**
      - guardar tras cambiar el distrito ⇒ aparece la comparación con **las dos** columnas de
        importes y **no** se escribió nada hasta confirmar. **(R33)**
      - con `tarifa: "sin_tarifa"` la pantalla dice «sin tarifa configurada» y **no** pinta `₡0`. **(R13)**
      - con `fleteOrigen: "especial_sin_pacto"` aparece la señal correspondiente. **(R14)**
      - con `yaEnUnCierre: true` aparece el aviso de cierre; con `false`, no. **(R16)**
      - `validation_error` en `distritoId` ⇒ motivo junto al campo, borrador conservado, sin ids
        internos. **(R34)**
      - con `numGuia` la advertencia de la etiqueta menciona la **dirección**; sin guía, no aparece. **(R36)**
      - barrido del texto renderizado: **ninguna** cadena promete registro/auditoría de la
        corrección. **(R35)**
      - los casos de la 312 (fallo cerrado del disparador, relectura tras éxito) siguen verdes. **(R27)**
      _Hecho:_ todos verdes.

---

## Bloque F — Superficie `/novedades` (frontend)

- [x] **F1 ⇐ E2** ~~`app/(app)/novedades/page.tsx` pide `obtenerCatalogoFiltrosOrdenes` y
      `NovedadesModule` pasa la geografía al modal.~~ **NO SE HACE ASÍ, Y ESTÁ MEDIDO
      (2026-08-29).** Ese import es EXACTAMENTE lo que el propio criterio de «hecho» de esta tarea
      prohíbe: con él, `novedad-acciones-sin-maqueta.guardia` se pone ROJA en su frente 4 (el censo
      inverso, 240/R38), que exige que toda Server Action importada por un archivo de
      `app/(app)/novedades/**` esté declarada como acción de fila o exceptuada a mano. Medido
      añadiendo el import y corriendo la guardia:

      ```
      × 240/R38 — ninguna Server Action de fila se dispara sin estar declarada en la tabla
        + [ "obtenerCatalogoFiltrosOrdenes (lo dispara app/(app)/novedades/page.tsx)" ]
      ```

      Las dos salidas eran editar la guardia (que esta tarea prohíbe) o no meter la acción en ese
      árbol. Se elige la segunda: el catálogo lo pide la VENTANA, que vive en
      `app/(app)/ordenes/_components/`, con SWR y clave compartida — el mismo patrón con el que
      `FiltrosEntregas` (`/dashboard`) y la barra de analítica piden ESE MISMO catálogo desde el
      cliente. **`/novedades` no se toca: ni `page.tsx`, ni `NovedadesTabs`, ni `NovedadesModule`, ni
      `ACCIONES_POR_GRUPO`.**
      _Hecho:_ typecheck 0; `pnpm exec vitest run novedad-acciones` **verde (43/43), sin haber
      editado ninguna de las dos guardias y sin un solo archivo de `/novedades` en el diff**.
- [x] **F2 ⇐ F1** Ampliar `tests/components/CorregirDatosCliente.novedades.test.tsx`:
      - el modal abierto desde una card de `devolucion` **y** desde una de `ayuda` ofrece los
        **nueve** campos, iguales en las dos. **(R32)**
      - el flujo de confirmación funciona igual que en `/ordenes` (una sola implementación). **(R32, R33)**
      _Hecho:_ verdes.

---

## Bloque G — Cierre

- [ ] **G1 ⇐ todo lo anterior** `progress/impl_327.md` con el mapa `R<n> → test` **completo** y
      **commiteado** (un informe sin commitear se pierde con el primer `git checkout`).
      _Hecho:_ los **36** requisitos tienen archivo y nombre de test. Incluye una sección con **la
      enmienda declarada a 312/R5 y 312/R14** (`requirements.md` §D6), para que quien lea el informe
      no la lea como un incumplimiento.
- [x] **G2 ⇐ G1** **Gate COMPLETO** (`./init.sh`), no el rápido: esta ficha toca `lib/types/` y el
      rápido **se niega solo**. `INIT_EXIT` escrito **dentro** del log.
      _Hecho (tanda de FRONTEND, 2026-08-29):_ `INIT_EXIT=0`, escrito dentro del log —y hacía falta:
      la primera corrida terminó con **exit code 0 en el proceso de fondo y `INIT_EXIT=1` dentro del
      log** (typecheck rojo en un test). **21.695 pasados, 26 saltados, 1 rojo**, 1.554 archivos,
      444,76 s. typecheck 0, lint 0 errores (126 avisos, todos heredados).
      Verdes uno a uno: `cierre-detail-inmutable` (3, la prueba de R17), `novedad-acciones-una-tabla`
      (8), `novedad-acciones-sin-maqueta` (19), `orden-nota-frontera` (10),
      `orden-geocode-enqueue` (8), `corregir-datos-sin-rastro` (16, ya con el panel del aviso en su
      censo), `corregir-ubicacion-importes` (9), `corregir-ubicacion-geocode` (11),
      `CorregirDatosCliente.ordenes` (40) y `CorregirDatosCliente.novedades` (13).
      **Delta de rojos = 0.** El único rojo es el heredado, nombrado: `superficie-de-uso.guardia`
      → `lib/actions/tarifas.ts:67 obtenerTarifa` (ficha 275). ⚠️ Y esa lista es de UNA sola
      entrada: `obtenerUbicacionOrden` **no aparece en ella**, que es la prueba positiva de que
      borrar su `@sin-superficie` era lo correcto y de que la ventana la alcanza de verdad.
- [ ] **G3 ⇐ G2** Repaso a mano en la app (la suite no encuentra lo que ver la app sí):
      - corregir la dirección de una orden como `maestro` desde `/ordenes` y comprobar que **no**
        pide confirmación;
      - corregir el distrito de esa orden y comprobar que **sí** la pide, que enseña los dos
        importes y que al confirmar la zona cambia en el listado;
      - repetir como `adminTienda` desde `/novedades`, **en las dos pestañas**;
      - elegir un distrito cuya zona no tenga tarifa y comprobar que dice «sin tarifa configurada» y
        **no** `₡0`;
      - comprobar en la base que quedó un job `geocodificacion` pendiente para esa orden.
      _Hecho:_ notas del recorrido en `progress/impl_327.md`.

---

## Mapa requisito → test

| Req | Dónde se prueba |
| --- | --- |
| R1 | A3 (los nueve juntos), B5 casos 1 y 3 (las columnas que cambian) |
| R2 | A3 (las ocho claves, una por una), D2 |
| R3 | A3 (geografía parcial vs. completa) |
| R4 | A3 (`distritoId` nulo y vacío) |
| R5 | A3 (`zonaId` rechazado por el borde), C2 («la zona derivada, nunca la del input»), B5 caso 2 |
| R6 | C2 (distrito fuera del cantón; cantón fuera de la provincia) |
| R7 | C2 (0 y 2 zonas), B5 caso 7 (contra Postgres) |
| R8 | A3 (dirección vacía y de espacios), B5 caso 1 (se guarda recortada) |
| R9 | A3 (`peso` 0 y negativo) |
| R10 | C2 («nada que cambiar ⇒ cero escrituras») |
| R11 | C2 (gate sin confirmación ⇒ aviso con las dos columnas y cero escrituras), E4 |
| R12 | C4 (importes contra literales calculados a mano, con mutación) |
| R13 | C2 (`tarifa: "sin_tarifa"`), E4 (no pinta `₡0`) |
| R14 | C2 (`especial_sin_pacto`), E4 |
| R15 | C2 (con confirmación escribe), B5 caso 2 |
| R16 | C2 (`yaEnUnCierre` true/false), E4 |
| R17 | B5 caso 5 (`cierre_detail` idéntico campo a campo), G2 (`cierre-detail-inmutable` verde sin tocarla) |
| R18 | C2 (precarga con rol denegado), D2 (sin sesión y orden ajena) |
| R19 | B6 (una fila encolada, con su `dedupeKey` y su `maxIntentos`) |
| R20 | B6 (los tres casos que NO encolan) |
| R21 | B6 (el 4.º argumento es el `tx`; con `conflict` no queda job) |
| R22 | B5 caso 4 (coordenadas y estado de geocodificación sin tocar) |
| R23 | B6 (`payload` exactamente `{ ordenId }`) |
| R24 | C3 (el bloque del tipo, con contraprueba) |
| R25 | B5 caso 5 (cero filas nuevas en historial y notas), C3 (estructural) |
| R26 | C3 (barrido de `console` y de PII en textos de rechazo, con contraprueba) |
| R27 | C2 (los casos de rol/ventana repetidos con los campos nuevos), E4 |
| R28 | C2 («se decide con el actor, no con el input»), D2 |
| R29 | B5 caso 6, C2 (el repositorio devuelve `conflict`) |
| R30 | C2 (inexistente, borrada y ajena ⇒ el mismo objeto), D2 |
| R31 | E4 (los nueve precargados; encadenamiento de los selectores) |
| R32 | F2 (las dos pestañas ofrecen los mismos nueve campos) |
| R33 | E4 (no se escribe hasta confirmar), F2 |
| R34 | E4 (borrador conservado, motivo sin ids) |
| R35 | E4 (barrido del texto renderizado), C3 (censo) |
| R36 | E4 (`numGuia` con y sin valor; el aviso nombra la dirección) |

Treinta y seis requisitos, treinta y seis filas. Ninguna fila apunta a una tarea que no exista, y
ninguna tarea cubre un requisito retirado.

---

## Riesgos anotados

- **El gate rápido se negará solo.** La ficha toca `lib/types/` en A1/A2: es un `fail`, no un aviso.
  Presupuestar el gate completo (la 312 midió ~21.000 tests).
- **Base local compartida entre worktrees.** Esta ficha no trae migración, así que no genera el
  riesgo — pero sí lo puede sufrir. Si `prisma migrate status` señala otra base, parar.
- **`prisma generate` se pisa entre worktrees.** Si el typecheck falla en archivos generados,
  `rm -rf .next/dev` y regenerar antes de creerse el rojo.
- **`dev` se mueve.** Antes de abrir el PR, comparar el SHA medido en G2 con `origin/dev`.
- **Las cuatro pruebas de la 312 que se ponen rojas a propósito** (`design.md` §8.2). Si alguien las
  «arregla» borrándolas, esta ficha pierde justo la red que documenta qué puertas siguen cerradas.
- **La tentación de calcular el importe en el navegador.** Está medida y costó céntimos reales
  (feature 204). Si aparece la necesidad de pintar un importe que el servidor no mandó, se para.
- **El aviso que nadie lee.** El gate es server-side (R11) precisamente para que el aviso no dependa
  de que la pantalla lo pinte. Si en algún momento la implementación mueve la decisión al cliente,
  ha reabierto D5 y va a la puerta de aprobación humana.
- **Preguntas abiertas vivas: cuatro** (P1–P4, `requirements.md`). Ninguna bloquea la
  implementación del camino principal, pero **P1 puede cambiar R13 y su test** si el humano prefiere
  bloquear en vez de avisar.
</content>
