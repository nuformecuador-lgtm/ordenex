# Ficha 312 — Tareas

Convenciones: `[P]` = puede ir en paralelo con las demás `[P]` de su mismo bloque.
`⇐ Tn` = depende de esa tarea. Cada tarea dice su criterio de **Hecho**.
Los `(Rn)` al final de cada tarea son los requisitos que cubre. **Numeración vigente: R1–R30**
(`requirements.md`, revisión del 2026-08-28).

**Orden global obligatorio: backend → frontend.** Bloques A→D antes que E/F.
**No hay migraciones en esta ficha** (design §2.1): si alguien acaba escribiendo una, es señal de
que se salió del alcance — parar y volver al spec.
**No hay rastro** (D4, design §6): si alguien acaba escribiendo una nota, una fila de historial o
una tabla de auditoría, es la misma señal. La ausencia de rastro es una decisión humana del
2026-08-28, y B3/caso 4 la mide.

---

## Bloque 0 — Antes de tocar nada

- [x] **T0.1** Releer, con el archivo delante y sin fiarse de este spec:
      `lib/repositories/OrdenRepository.ts:1362` (`update`),
      `lib/repositories/ChatConversacionRepository.ts:65` (`resolverOrdenActivaPorNumero`) y
      `:141` (`findByOrdenParaMensajero`, el desempate que sostiene design §5.4),
      `lib/types/novedad-grupo.ts` (`ESTATUS_POR_GRUPO`, `grupoDeEstatus`),
      `app/(app)/novedades/_components/novedad-acciones-catalogo.ts`,
      `lib/types/orden.ts:39` (`actualizarOrdenSchema`, y que **no** lleva `.max()`).
      _Hecho:_ el censo del design §0 se confirma o se corrige **en el spec** antes de escribir
      código. Si algo no cuadra, se para y se pregunta.
- [x] **T0.2** `./init.sh --rapido` en verde sobre la rama recién creada, **antes** del primer
      cambio. _Hecho:_ log con `INIT_EXIT=0` escrito dentro del propio log (no fiarse del exit
      code del comando que lo canaliza).

---

## Bloque A — Módulos puros y contratos (sin I/O)

- [x] **A1 [P]** `lib/types/correccion-datos-cliente.ts`: `CAMPOS_CORREGIBLES`,
      `ESTADOS_SIN_CORRECCION` (derivado de `ESTADOS_TERMINALES` + `"rechazada"`, con
      `satisfies readonly OrderStatusValue[]`), `estadoAdmiteCorreccion`, `rolAdmiteCorreccion`
      (que para `adminTienda` decide con `grupoDeEstatus(...) !== null` leyendo
      `lib/types/novedad-grupo.ts`, **no** con una lista propia de dos estados — design §3.1).
      _Hecho:_ `tests/unit/types/correccion-datos-cliente.test.ts` verde con casos:
      los 3 terminales + `rechazada` devuelven `false`; `en_reparto`/`devuelta`/`ayuda_tienda`/
      `en_bodega_central` devuelven `true`; `undefined` y `null` devuelven `false`;
      `adminTienda` con `devuelta` ⇒ `true` **y con `ayuda_tienda` ⇒ `true`** (P2);
      `adminTienda` con `en_reparto` ⇒ `false`;
      `mensajero`/`adminSatelite`/`apiKey` siempre `false`. **(R8, R9, R10, R11, R24)**
- [x] **A2 [P] ⇐ A1** `corregirDatosClienteSchema` en el mismo módulo, **derivado** de
      `actualizarOrdenSchema` con `.pick(...).strict().extend({ordenId}).refine(...)`.
      _Hecho:_ `tests/unit/types/correccion-datos-cliente-schema.test.ts` verde:
      una clave fuera de los 4 (`estatusId`, `zonaId`, `peso`, `direccion`) ⇒ error;
      objeto con solo `ordenId` ⇒ error del `refine`; `destinatario: ""` ⇒ error;
      `notas: null` ⇒ válido; **`producto` y `notas` de 5.000 caracteres ⇒ VÁLIDOS y sin
      recortar** (R6: ningún tope propio, igual que la carga). **(R1, R2, R3, R6)**
- [x] **A3 [P] ⇐ A2** `lib/interfaces/services/ICorregirDatosClienteService.ts` con
      `CorregirDatosClienteInput`, los cuatro desenlaces de design §4.2 y el docstring de por qué
      es servicio propio y no un método de `IOrdenService`.
      _Hecho:_ typecheck limpio; el union no tiene ninguna rama sin usar.

> **Ya no existe la tarea de textos del servidor.** La versión anterior tenía un `A3` para
> `lib/services/mensajes-corregir-datos-cliente.ts`, que componía el cuerpo de la nota automática.
> Con D4 el servidor no compone ningún texto (design §1): sale entera, junto con sus tests de
> recorte al tope del hilo.

---

## Bloque B — Repositorio (backend, con Postgres)

- [x] **B1 ⇐ A1** `IOrdenRepository`: declarar `CorregirDatosClienteData` (4 claves, **sin**
      `estatusId` ni `direccion`) y `corregirDatosCliente(ordenId, data, estadosBloqueados)`.
      `update` **no se toca**.
      _Hecho:_ typecheck; y una nota en el docstring diciendo que la ausencia de `estatusId` es
      el mecanismo por el que R14 no depende de que nadie se acuerde.
- [x] **B2 ⇐ B1** `OrdenRepository`: el método `corregirDatosCliente` como **un solo**
      `updateMany` con la ventana en el `WHERE` (design §7). **Sin `$transaction` y sin tocar el
      constructor**: con una sola sentencia no hay dos escrituras que coordinar.
      _Hecho:_ typecheck; `grep` que confirme 0 call-sites de `new OrdenRepository(...)` tocados;
      y que el archivo del repositorio **no gana** ningún import del hilo de notas.
- [x] **B3 ⇐ B2** `tests/integration/db/corregir-datos-cliente.repo.test.ts` **contra Postgres**
      (los tests de servicio usan dobles y no ven el `WHERE`).
      Casos, cada uno con su fila sembrada:
      1. orden en `en_reparto` ⇒ `"ok"` y las 4 columnas cambian.
      2. orden en cada uno de los 4 estados bloqueados ⇒ `"conflict"` y **cero** columnas
         cambiadas. **(R11, R13)**
      3. orden con `deleted_at` ⇒ `"conflict"`, sin efectos. **(R12)**
      4. tras el caso 1: `SELECT count(*)` sobre `orden_historial_estado` **y** sobre `orden_nota`
         para esa orden **no aumenta ninguno**. Este caso ES la medición de D4: la ausencia de
         rastro se comprueba, no se supone. **(R14)**
      5. tras el caso 1: comparación fila-a-fila del `orden` antes/después — cambian **solo** las
         4 columnas **y `updated_at`**, y `updated_at` **sí** cambió. **(R5, R15)**
      6. `producto` de 5.000 caracteres ⇒ `"ok"` y la columna guarda los 5.000 íntegros (el tope
         no existe tampoco en la base). **(R6)**
      _Hecho:_ los 6 casos verdes, y **cada uno matado con una mutación** antes de creerlo (quitar
      el `notIn` del `WHERE` debe poner rojo el caso 2; quitar el `deletedAt: null`, el caso 3).

---

## Bloque C — Servicio

- [x] **C1 ⇐ A1,A3,B1** `lib/services/CorregirDatosClienteService.ts` con la secuencia de
      design §3.2. Dependencias por `Pick<…>` de interfaz, como `EliminarOrdenService`.
      _Hecho:_ se construye entero con dobles; no importa Prisma ni `next/headers`.
- [x] **C2 ⇐ C1** `tests/unit/services/corregir-datos-cliente-service.test.ts`:
      - `mensajero` / `adminSatelite` / `apiKey` ⇒ `forbidden`, y **el repositorio no se llama**. **(R10)**
      - `adminTienda` sobre orden de otra tienda ⇒ `forbidden`. **(R9)**
      - `adminTienda` sobre orden propia en `devuelta` ⇒ `ok`. **(R9)**
      - `adminTienda` sobre orden propia en **`ayuda_tienda` ⇒ `ok`** (P2, 2026-08-28). **(R9)**
      - `adminTienda` sobre orden propia en `en_reparto` (fuera de los dos grupos) ⇒ `forbidden`. **(R9)**
      - `maestro` y `admin` sobre orden de cualquier tienda en un estado permitido ⇒ `ok`. **(R8)**
      - orden inexistente, borrada y ajena ⇒ **el mismo objeto** `{status:"forbidden"}`. **(R12)**
      - estado bloqueado ⇒ `forbidden` **sin** llamar al repositorio de escritura. **(R11)**
      - repositorio devuelve `"conflict"` ⇒ `{status:"conflict"}`. **(R13)**
      - valores idénticos a los almacenados (incluidos los que solo difieren en espacios) ⇒
        `{status:"ok", cambios: []}` y **cero** llamadas de escritura. **(R4)**
      - `telefonoDest: "abc"` (normaliza a `""`) ⇒ `validation_error`, sin escrituras. **(R18)**
      - la decisión se toma con el rol y la tienda **del actor**, jamás con lo que venga en el
        input (un input que traiga `rol`/`tiendaId` no cambia el desenlace). **(R25)**
      _Hecho:_ todos verdes; ninguna aserción compara un texto contra la función que lo genera.
- [x] **C3 [P] ⇐ C1** Comprobación **estructural** de la ausencia de rastro: ningún módulo de la
      ficha (`lib/services/CorregirDatosClienteService.ts`, `lib/actions/corregir-datos-cliente.ts`,
      `lib/repositories/OrdenRepository.corregirDatosCliente`) importa `OrdenNotaRepository`,
      `OrdenNotaService`, `lib/actions/orden-notas` ni escribe en `orden_historial_estado`.
      _Hecho:_ verde **con contraprueba** (inyectar el import en el test debe ponerlo rojo). Y
      `pnpm exec vitest run orden-nota-frontera` sigue verde **sin haber tocado esa guardia**:
      su censo cerrado no cambia porque esta ficha no añade ninguna operación al hilo. **(R14)**

---

## Bloque D — Server Action

- [x] **D1 ⇐ A2,C1** `lib/actions/corregir-datos-cliente.ts`: `"use server"`,
      `withErrorHandler` + `resolveActorFromSession` + `corregirDatosClienteSchema` +
      `buildService()`, traductor de `AppErrorShape` a `{unauthenticated}` /
      `{validation_error}`. Patrón literal de `lib/actions/eliminar-orden.ts`.
      _Hecho:_ typecheck; el composition root **pasa de verdad** el repositorio al servicio (no
      basta con importarlo).
- [x] **D2 ⇐ D1** `tests/unit/actions/corregir-datos-cliente.action.test.ts`:
      - sin sesión ⇒ `{status:"unauthenticated"}` **y el servicio no se construye**. **(R7)**
      - entrada con `estatusId` ⇒ `validation_error`, servicio no llamado. **(R2)**
      - entrada sin ningún campo ⇒ `validation_error`. **(R3)**
      - con sesión y entrada válida ⇒ delega en el servicio con el actor de la sesión. **(R25)**
      _Hecho:_ verdes con dobles inyectados por `deps`.
- [x] **D3 [P] ⇐ D1** Test dedicado: ningún módulo de la feature contiene `console.` ni interpola
      `destinatario`/`telefono`/`producto`/`notas` en un texto de error. Se reusa **como técnica**
      el detector de `console.` que ya vive en `tests/unit/guards/orden-nota-frontera.guardia.test.ts`
      (se cita solo como precedente del mecanismo: esta ficha no toca el hilo de notas).
      _Hecho:_ verde, con **contraprueba** (un `console.log(orden.telefonoDest)` inyectado en el
      test debe ponerlo rojo). **(R16)**

---

## Bloque E — Superficie `/ordenes` (frontend)

- [x] **E1 ⇐ D1** `CorregirDatosClienteModal.tsx` (+ `corregir-datos-cliente-error-messages.ts`):
      tipo estructural `CorregirDatosClienteOrdenUI`, 4 campos precargados, validación en cliente
      con **el mismo** schema (sin largo máximo propio), los dos avisos condicionales, errores
      traducidos por causa. **Ningún texto promete rastro** («se registrará quién lo cambió» y
      similares están prohibidos: no se registra, design §9.3).
      _Hecho:_ compila y se monta en el test de E3.
- [x] **E2 ⇐ E1** `CorregirDatosClienteAccion.tsx` (disparador por fila, patrón
      `ReportarIncidenteAccion`: `return null` cuando no aplica) + cableado en `OrdenesModule`
      (tercera fuente de la columna `acciones`), `OrdenesListado` (prop pasante) y
      `app/(app)/ordenes/page.tsx` (`puedeCorregirDatos = esAccesoTotal(rol)`).
      _Hecho:_ typecheck y `adminTienda` **no** recibe la prop (verificado en el test de E3).
- [x] **E3 ⇐ E2** `tests/components/CorregirDatosCliente.ordenes.test.tsx`:
      - el disparador **no se renderiza** con `estatusValue` en cada uno de los 4 bloqueados,
        ni con `estatusValue: undefined`. **(R22, R24)**
      - se renderiza en `en_reparto`. **(R22)**
      - el modal abre con los 4 valores actuales dentro. **(R26)**
      - un `producto` de 5.000 caracteres tecleado en el modal **no** produce error de cliente. **(R6)**
      - con `numGuia: 8123` aparece el aviso de la etiqueta; con `numGuia: null`, no; **y en
        ningún caso hay un botón de reimprimir dentro del modal** (P4). **(R27)**
      - al editar el teléfono aparece el aviso de WhatsApp; sin tocarlo, no. **(R28)**
      - éxito ⇒ se invoca la relectura del listado y el modal cierra. **(R29)**
      - rechazo `forbidden` ⇒ el borrador se conserva, se pinta un motivo accionable y **no**
        aparece ningún id ni el detalle del rechazo. **(R30)**
      _Hecho:_ todos verdes.

---

## Bloque F — Superficie `/novedades` (frontend)

- [x] **F1 ⇐ D1** `novedad-acciones-catalogo.ts`: `AccionNovedad` += `"corregirDatos"`;
      celda en `ACCIONES_POR_GRUPO.devolucion` **Y en `ACCIONES_POR_GRUPO.ayuda`** (R23, P2);
      **una sola clave para los dos grupos** (design §9.2: misma operación, mismo servicio, mismo
      modal — el precedente es `contacto`, no `reprogramarDesdeAyuda`);
      entrada en `PRODUCTOR_POR_ACCION` apuntando a `corregirDatosCliente` /
      `lib/actions/corregir-datos-cliente`.
      _Hecho:_ `pnpm exec vitest run novedad-acciones` verde (las **dos** guardias: la de una sola
      tabla y la de sin-maqueta, que exige que algún archivo de `app/(app)/novedades/` importe de
      verdad esa Server Action). **(R23)**
- [x] **F2 ⇐ F1,E1** `NovedadAcciones.tsx` (icono `PencilLine`, rótulo «Corregir datos», nombre
      accesible con el destinatario) + `NovedadesModule.tsx` (estado, montaje del modal
      **importado de `ordenes/_components`**, relectura tras éxito).
      _Hecho:_ typecheck; el modal no se duplica; el handler es **uno solo**, sin ramificar por
      grupo.
- [x] **F3 ⇐ F2** `tests/components/CorregirDatosCliente.novedades.test.tsx`:
      - la acción aparece en una card del grupo `devolucion`. **(R23)**
      - la acción aparece **también** en una card del grupo `ayuda`. **(R23)**
      - éxito ⇒ la lista se relee del servidor. **(R29)**
      _Hecho:_ verdes.

---

## Bloque G — WhatsApp y cierre

- [x] **G1 ⇐ B2** `tests/integration/db/corregir-datos-cliente.chat.test.ts` **contra Postgres**:
      sembrar orden viva con mensajero asignado, `telefono_dest = "8888-7777"`, y un
      `chat_conversacion` con `telefono_e164 = "50688887777"` y 2 mensajes. Corregir a
      `"8888-9999"`. Entonces:
      - `resolverOrdenActivaPorNumero("50688889999")` devuelve **esa** orden. **(R20)**
      - `resolverOrdenActivaPorNumero("50688887777")` devuelve `null` para esa orden. **(R21)**
      - la fila de `chat_conversacion` del número viejo **sigue existiendo** con sus 2 mensajes y
        su `telefono_e164` **sin cambiar**. **(R19)**
      _Hecho:_ verde, y el caso R21 matado con una mutación (si el `UPDATE` no escribiera
      `telefono_dest`, R20 debe caer).
- [x] **G2 [P] ⇐ B2** Test que confirma que la feature **no llama** a
      `ChatConversacionRepository.migrarTelefono` ni a ninguna otra escritura del módulo de chat
      (design §5.3, D5): `grep` estructural sobre los módulos de la ficha.
      _Hecho:_ verde con contraprueba. **(R19)**
- [x] **G3 ⇐ B3** Caso de guardado del teléfono dentro del test de integración de B3: tras
      corregir con `" 8888-9999 "`, la columna guarda `"8888-9999"` (recortado, **no**
      `"50688889999"`), igual que la carga (T1, 2026-08-28).
      _Hecho:_ verde. **(R17)**
- [ ] **G4 ⇐ todo lo anterior** `progress/impl_312.md` con el mapa `R<n> → test` **completo** y
      **commiteado** (un informe sin commitear se pierde con el primer `git checkout`).
      _Hecho:_ los **30** requisitos tienen su archivo y su nombre de test; ninguno sin cubrir.
      Incluye una línea recordando que **no hay rastro por decisión del 2026-08-28** (D4), para
      que quien lea el informe no lo lea como un hueco.
- [x] **G5 ⇐ G4** `./init.sh --rapido` verde, con `INIT_EXIT` escrito **dentro** del log.
      _Hecho:_ typecheck 0, lint 0, tests relacionados verdes y **todas** las guardias verdes
      (en especial `novedad-acciones-una-tabla`, `novedad-acciones-sin-maqueta`,
      `superficie-de-uso`, y `orden-nota-frontera` — que debe seguir verde **sin haberla
      tocado**).
      _Lo que se corrió, 2026-08-28:_ el gate **COMPLETO** (`./init.sh`), no el rápido. El rápido
      **se niega solo** porque esta ficha tocó `lib/types/` (el módulo puro `correccion-datos-
      cliente.ts` de la tanda de backend), y eso es un `fail`, no un aviso. Resultado:
      `INIT_EXIT=0`, `== init OK ==`, **21.134 tests verdes** y **3 archivos rojos, los TRES del
      baseline** (`superficie-de-uso` → `obtenerTarifa` de la 275, `usuario-descarga` y
      `usuarios-filtro-busqueda`, los dos por la `zonaNombre` de la 285). **Delta de esta tanda:
      cero.** Nota para `design.md` §2.1, que dice lo contrario: la ficha no trae migración, pero
      el módulo de tipos basta para que el rápido se niegue.
- [ ] **G6 ⇐ G5** Repaso a mano en la app (la suite no encuentra lo que ver la app sí):
      - corregir una orden como `maestro` desde `/ordenes`;
      - corregir una orden como `adminTienda` desde `/novedades`, **en las dos pestañas**
        (devolución y ayuda);
      - comprobar en la propia pantalla que los valores nuevos aparecen tras la relectura, que el
        aviso de la etiqueta sale solo con guía y que **ninguna pantalla anuncia un registro de la
        corrección** que no existe.
      _Hecho:_ capturas o notas del recorrido en `progress/impl_312.md`.

---

## Mapa requisito → test

| Req | Dónde se prueba |
| --- | --- |
| R1 | A2 (`correccion-datos-cliente-schema.test.ts`) |
| R2 | A2, D2 |
| R3 | A2, D2 |
| R4 | C2 («valores idénticos ⇒ cambios vacío, cero escrituras») |
| R5 | B3 caso 5 (comparación fila-a-fila contra Postgres) |
| R6 | A2 (5.000 caracteres válidos), B3 caso 6 (la base los guarda), E3 (el modal no los rechaza) |
| R7 | D2 («sin sesión ⇒ unauthenticated, servicio no construido») |
| R8 | A1, C2 |
| R9 | A1 (`devuelta` y `ayuda_tienda`), C2 (cuatro casos de `adminTienda`) |
| R10 | A1, C2 |
| R11 | A1, C2, B3 caso 2 |
| R12 | C2 («inexistente, borrada y ajena devuelven el mismo objeto»), B3 caso 3 |
| R13 | B3 caso 2, C2 («repo devuelve conflict») |
| R14 | B3 caso 4 (cero filas nuevas en `orden_historial_estado` **y** en `orden_nota`), C3 (estructural, con contraprueba) |
| R15 | B3 caso 5 (`updated_at` sí cambió) |
| R16 | D3 (detector + contraprueba) |
| R17 | G3 |
| R18 | C2 (`telefonoDest: "abc"` ⇒ validation_error) |
| R19 | G1 (la fila vieja sigue intacta), G2 (no se llama a `migrarTelefono`) |
| R20 | G1 |
| R21 | G1 |
| R22 | E3 |
| R23 | F1 (guardias), F3 (las dos pestañas) |
| R24 | A1 (`undefined`/`null` ⇒ false), E3 |
| R25 | D2, C2 (el servidor decide con el actor, no con el input) |
| R26 | E3 |
| R27 | E3 (`numGuia` con y sin valor; sin botón de reimprimir) |
| R28 | E3 (teléfono tocado y sin tocar) |
| R29 | E3, F3 |
| R30 | E3 |

Treinta requisitos, treinta filas. Ninguna fila apunta a una tarea que no exista, y ninguna tarea
cubre un requisito retirado.

---

## Riesgos anotados

- **Base local compartida entre worktrees.** No hay migración en esta ficha, así que el riesgo
  habitual (una migración de otra feature poniendo rojo este gate) no lo genera esta rama — pero
  sí lo puede sufrir. Si `prisma migrate status` señala otra base, parar.
- **`prisma generate` se pisa entre worktrees.** Si el typecheck falla en archivos generados,
  `rm -rf .next/dev` y regenerar antes de creerse el rojo.
- **`dev` se mueve.** Antes de abrir el PR, comparar el SHA medido en G5 con `origin/dev`.
- **La tentación de dejar «solo un logcito».** R16 y D4 apuntan al mismo sitio: ni rastro
  persistido ni rastro en logs. Si durante la implementación aparece la necesidad real de saber
  quién corrigió qué, **no se resuelve por la puerta de atrás**: se para y se lleva a la puerta de
  aprobación humana, porque es reabrir D4.
- **Un tercer grupo en `/novedades`.** `rolAdmiteCorreccion` deriva la ventana del `adminTienda`
  de `ESTATUS_POR_GRUPO`, así que un grupo nuevo habilitaría la corrección allí sin que nadie lo
  decida (design §3.1). Es la lectura pretendida de la regla, pero conviene mirar esa línea el día
  que aparezca.
- **Preguntas abiertas: ninguna.** P1–P4 y T1–T3 quedaron respondidas el 2026-08-28 y están
  recogidas en `requirements.md` §Preguntas resueltas y en `design.md` §12.
