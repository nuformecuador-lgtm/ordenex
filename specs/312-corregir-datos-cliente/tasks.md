# Ficha 312 — Tareas

Convenciones: `[P]` = puede ir en paralelo con las demás `[P]` de su mismo bloque.
`⇐ Tn` = depende de esa tarea. Cada tarea dice su criterio de **Hecho**.
Los `(Rn)` al final de cada tarea son los requisitos que cubre.

**Orden global obligatorio: backend → frontend.** Bloques A→D antes que E/F.
**No hay migraciones en esta ficha** (design §2.1): si alguien acaba escribiendo una, es señal de
que se salió del alcance — parar y volver al spec.

---

## Bloque 0 — Antes de tocar nada

- [ ] **T0.1** Releer, con el archivo delante y sin fiarse de este spec:
      `lib/repositories/OrdenRepository.ts:1362` (`update`),
      `lib/repositories/OrdenNotaRepository.ts`,
      `lib/repositories/ChatConversacionRepository.ts:65`,
      `tests/unit/guards/orden-nota-frontera.guardia.test.ts`,
      `app/(app)/novedades/_components/novedad-acciones-catalogo.ts`.
      _Hecho:_ el censo del design §0 se confirma o se corrige **en el spec** antes de escribir
      código. Si algo no cuadra, se para y se pregunta.
- [ ] **T0.2** `./init.sh --rapido` en verde sobre la rama recién creada, **antes** del primer
      cambio. _Hecho:_ log con `INIT_EXIT=0` escrito dentro del propio log (no fiarse del exit
      code del comando que lo canaliza).

---

## Bloque A — Módulos puros y contratos (sin I/O)

- [ ] **A1 [P]** `lib/types/correccion-datos-cliente.ts`: `CAMPOS_CORREGIBLES`,
      `ESTADOS_SIN_CORRECCION` (derivado de `ESTADOS_TERMINALES` + `"rechazada"`, con
      `satisfies readonly OrderStatusValue[]`), `estadoAdmiteCorreccion`, `rolAdmiteCorreccion`
      (que lee `ESTATUS_POR_GRUPO.devolucion` de `lib/types/novedad-grupo.ts`, no lo re-escribe).
      _Hecho:_ `tests/unit/types/correccion-datos-cliente.test.ts` verde con casos:
      los 3 terminales + `rechazada` devuelven `false`; `en_reparto`/`devuelta`/`en_bodega_central`
      devuelven `true`; `undefined` y `null` devuelven `false`; `adminTienda` solo con `devuelta`;
      `mensajero`/`adminSatelite`/`apiKey` siempre `false`. **(R7, R8, R9, R10, R26)**
- [ ] **A2 [P] ⇐ A1** `corregirDatosClienteSchema` en el mismo módulo, **derivado** de
      `actualizarOrdenSchema` con `.pick(...).strict().extend({ordenId}).refine(...)`.
      _Hecho:_ `tests/unit/types/correccion-datos-cliente-schema.test.ts` verde:
      una clave fuera de los 4 (`estatusId`, `zonaId`, `peso`, `direccion`) ⇒ error;
      objeto con solo `ordenId` ⇒ error del `refine`; `destinatario: ""` ⇒ error;
      `notas: null` ⇒ válido. **(R1, R2, R3)**
- [ ] **A3 [P]** `lib/services/mensajes-corregir-datos-cliente.ts`: composición del cuerpo
      (orden fijo de campos, `«viejo» → «nuevo»`, `(sin notas)`, prefijo, separador ` · `,
      recorte a `CUERPO_MAX` con `…`) + los textos de conflicto/`forbidden` sin PII.
      _Hecho:_ `tests/unit/services/mensajes-corregir-datos-cliente.test.ts` verde:
      un campo; cuatro campos; `notas` vacío; y un `producto` de 500 caracteres cuyo resultado
      mide **exactamente** `CUERPO_MAX` y termina en `…`. El test importa `CUERPO_MAX`, no un
      `200` literal. **(R13, R17)**
- [ ] **A4 [P] ⇐ A2** `lib/interfaces/services/ICorregirDatosClienteService.ts` con
      `CorregirDatosClienteInput`, los cuatro desenlaces de design §4.2 y el docstring de por qué
      es servicio propio y no un método de `IOrdenService`.
      _Hecho:_ typecheck limpio; el union no tiene ninguna rama sin usar.

---

## Bloque B — Repositorio (backend, con Postgres)

- [ ] **B1 ⇐ A1** `IOrdenRepository`: declarar `CorregirDatosClienteData` (4 claves, **sin**
      `estatusId` ni `direccion`) y `corregirDatosCliente(...)`. `update` **no se toca**.
      _Hecho:_ typecheck; y una nota en el docstring diciendo que la ausencia de `estatusId` es
      el mecanismo por el que R15 no depende de nadie.
- [ ] **B2 ⇐ B1** `OrdenRepository`: tercer parámetro del constructor con default
      (`notaRepoDe`) y el método `corregirDatosCliente` en una sola `$transaction`
      (design §7). Ni un `new OrdenRepository(prisma)` existente cambia.
      _Hecho:_ typecheck y `grep` que confirme 0 call-sites tocados.
- [ ] **B3 ⇐ B2** `tests/integration/db/corregir-datos-cliente.repo.test.ts` **contra Postgres**
      (los tests de servicio usan dobles y no ven el `WHERE`).
      Casos, cada uno con su fila sembrada:
      1. orden en `en_reparto` ⇒ `"ok"`, las 4 columnas cambian, **y una fila nueva en
         `orden_nota`** con el `autor_id`/`rol_autor` esperados. **(R13, R14, R16)**
      2. orden en cada uno de los 4 estados bloqueados ⇒ `"conflict"`, **cero** columnas
         cambiadas y **cero** filas en `orden_nota`. **(R10, R12)**
      3. orden con `deleted_at` ⇒ `"conflict"`, sin efectos. **(R11)**
      4. tras el caso 1: `SELECT count(*) FROM orden_historial_estado WHERE orden_id = …`
         **no aumenta**. **(R15)**
      5. tras el caso 1: comparación fila-a-fila del `orden` antes/después — solo cambian las 4
         columnas y `updated_at`. **(R5)**
      6. la nota falla (autor inexistente ⇒ violación de FK) ⇒ la transacción revierte y la
         orden **queda con los valores viejos**. **(R16)**
      _Hecho:_ los 6 casos verdes, y **cada uno matado con una mutación** antes de creerlo (quitar
      el `notIn` del `WHERE` debe poner rojo el caso 2; quitar el `create` debe poner rojo el 1).

---

## Bloque C — Servicio

- [ ] **C1 ⇐ A1,A3,A4,B1** `lib/services/CorregirDatosClienteService.ts` con la secuencia de
      design §3.2. Dependencias por `Pick<…>` de interfaz, como `EliminarOrdenService`.
      _Hecho:_ se construye entero con dobles; no importa Prisma ni `next/headers`.
- [ ] **C2 ⇐ C1** `tests/unit/services/corregir-datos-cliente-service.test.ts`:
      - `mensajero` / `adminSatelite` / `apiKey` ⇒ `forbidden`, y **el repositorio no se llama**. **(R9)**
      - `adminTienda` sobre orden de otra tienda ⇒ `forbidden`. **(R8)**
      - `adminTienda` sobre orden propia en `ayuda_tienda` ⇒ `forbidden` (hoy solo `devuelta`). **(R8)**
      - `adminTienda` sobre orden propia en `devuelta` ⇒ `ok`. **(R8)**
      - `maestro` y `admin` sobre orden de cualquier tienda en un estado permitido ⇒ `ok`. **(R7)**
      - orden inexistente, borrada y ajena ⇒ **el mismo objeto** `{status:"forbidden"}`. **(R11)**
      - estado bloqueado ⇒ `forbidden` **sin** llamar al repositorio de escritura. **(R10)**
      - repositorio devuelve `"conflict"` ⇒ `{status:"conflict"}`. **(R12)**
      - valores idénticos a los almacenados (incluidos los que solo difieren en espacios) ⇒
        `{status:"ok", cambios: []}` y **cero** llamadas de escritura. **(R4)**
      - `telefonoDest: "abc"` (normaliza a `""`) ⇒ `validation_error`, sin escrituras. **(R20)**
      - el `cuerpo` que llega al repositorio nombra **solo** los campos que cambiaron. **(R13)**
      - `autorId`/`rolAutor` que llegan al repositorio son los del actor, **jamás** del input. **(R14)**
      _Hecho:_ todos verdes; ninguna aserción compara un texto contra la función que lo genera
      (los cuerpos esperados se escriben a mano en el test).
- [ ] **C3 [P] ⇐ C1** Comprobar que el servicio **no** llama a `OrdenNotaService.publicar` sino a
      `IOrdenNotaRepository.crear` (design §6.1), y que el censo cerrado de la guardia del hilo
      sigue intacto. _Hecho:_ `pnpm exec vitest run orden-nota-frontera` verde. **(R13)**

---

## Bloque D — Server Action

- [ ] **D1 ⇐ A2,C1** `lib/actions/corregir-datos-cliente.ts`: `"use server"`,
      `withErrorHandler` + `resolveActorFromSession` + `corregirDatosClienteSchema` +
      `buildService()`, traductor de `AppErrorShape` a `{unauthenticated}` /
      `{validation_error}`. Patrón literal de `lib/actions/eliminar-orden.ts`.
      _Hecho:_ typecheck; el composition root **pasa de verdad** el repositorio del hilo (no basta
      con importarlo).
- [ ] **D2 ⇐ D1** `tests/unit/actions/corregir-datos-cliente.action.test.ts`:
      - sin sesión ⇒ `{status:"unauthenticated"}` **y el servicio no se construye**. **(R6)**
      - entrada con `estatusId` ⇒ `validation_error`, servicio no llamado. **(R2)**
      - entrada sin ningún campo ⇒ `validation_error`. **(R3)**
      - con sesión y entrada válida ⇒ delega en el servicio con el actor de la sesión. **(R27)**
      _Hecho:_ verdes con dobles inyectados por `deps`.
- [ ] **D3 [P] ⇐ D1** `tests/unit/guards/…` o test dedicado: ningún módulo de la feature contiene
      `console.` ni interpola `destinatario`/`telefono`/`producto`/`notas` en un texto de error.
      Se reusa el detector de `orden-nota-frontera.guardia.test.ts` en vez de escribir otro.
      _Hecho:_ verde, con **contraprueba** (un `console.log(orden.telefonoDest)` inyectado en el
      test debe ponerlo rojo). **(R18)**

---

## Bloque E — Superficie `/ordenes` (frontend)

- [ ] **E1 ⇐ D1** `CorregirDatosClienteModal.tsx` (+ `corregir-datos-cliente-error-messages.ts`):
      tipo estructural `CorregirDatosClienteOrdenUI`, 4 campos precargados, validación en cliente
      con **el mismo** schema, los dos avisos condicionales, errores traducidos por causa.
      _Hecho:_ compila y se monta en el test de E3.
- [ ] **E2 ⇐ E1** `CorregirDatosClienteAccion.tsx` (disparador por fila, patrón
      `ReportarIncidenteAccion`: `return null` cuando no aplica) + cableado en `OrdenesModule`
      (tercera fuente de la columna `acciones`), `OrdenesListado` (prop pasante) y
      `app/(app)/ordenes/page.tsx` (`puedeCorregirDatos = esAccesoTotal(rol)`).
      _Hecho:_ typecheck y `adminTienda` **no** recibe la prop (verificado en el test de E3).
- [ ] **E3 ⇐ E2** `tests/components/CorregirDatosCliente.ordenes.test.tsx`:
      - el disparador **no se renderiza** con `estatusValue` en cada uno de los 4 bloqueados,
        ni con `estatusValue: undefined`. **(R24, R26)**
      - se renderiza en `en_reparto`. **(R24)**
      - el modal abre con los 4 valores actuales dentro. **(R28)**
      - con `numGuia: 8123` aparece el aviso de la etiqueta; con `numGuia: null`, no. **(R29)**
      - al editar el teléfono aparece el aviso de WhatsApp; sin tocarlo, no. **(R30)**
      - éxito ⇒ se invoca la relectura del listado y el modal cierra. **(R31)**
      - rechazo `forbidden` ⇒ el borrador se conserva, se pinta un motivo accionable y **no**
        aparece ningún id ni el detalle del rechazo. **(R32)**
      _Hecho:_ todos verdes.

---

## Bloque F — Superficie `/novedades` (frontend)

- [ ] **F1 ⇐ D1** `novedad-acciones-catalogo.ts`: `AccionNovedad` += `"corregirDatos"`;
      celda en `ACCIONES_POR_GRUPO.devolucion` **y no en `ayuda`**;
      entrada en `PRODUCTOR_POR_ACCION` apuntando a `corregirDatosCliente` /
      `lib/actions/corregir-datos-cliente`.
      _Hecho:_ `pnpm exec vitest run novedad-acciones` verde (las **dos** guardias: la de una sola
      tabla y la de sin-maqueta, que exige que algún archivo de `app/(app)/novedades/` importe de
      verdad esa Server Action). **(R25)**
- [ ] **F2 ⇐ F1,E1** `NovedadAcciones.tsx` (icono `PencilLine`, rótulo «Corregir datos», nombre
      accesible con el destinatario) + `NovedadesModule.tsx` (estado, montaje del modal
      **importado de `ordenes/_components`**, relectura tras éxito).
      _Hecho:_ typecheck; el modal no se duplica.
- [ ] **F3 ⇐ F2** `tests/components/CorregirDatosCliente.novedades.test.tsx`:
      - la acción aparece en una card del grupo `devolucion`. **(R25)**
      - **no** aparece en una card del grupo `ayuda`. **(R25)**
      - éxito ⇒ la lista se relee del servidor. **(R31)**
      _Hecho:_ verdes.

---

## Bloque G — WhatsApp y cierre

- [ ] **G1 ⇐ B2** `tests/integration/db/corregir-datos-cliente.chat.test.ts` **contra Postgres**:
      sembrar orden viva con mensajero asignado, `telefono_dest = "8888-7777"`, y un
      `chat_conversacion` con `telefono_e164 = "50688887777"` y 2 mensajes. Corregir a
      `"8888-9999"`. Entonces:
      - `resolverOrdenActivaPorNumero("50688889999")` devuelve **esa** orden. **(R22)**
      - `resolverOrdenActivaPorNumero("50688887777")` devuelve `null` para esa orden. **(R23)**
      - la fila de `chat_conversacion` del número viejo **sigue existiendo** con sus 2 mensajes y
        su `telefono_e164` **sin cambiar**. **(R21)**
      _Hecho:_ verde, y el caso R23 matado con una mutación (si el `UPDATE` no escribiera
      `telefono_dest`, R22 debe caer).
- [ ] **G2 [P] ⇐ B2** Test que confirma que la feature **no llama** a
      `ChatConversacionRepository.migrarTelefono` (design §5.3): `grep` estructural sobre los
      módulos de la ficha. _Hecho:_ verde con contraprueba. **(R21)**
- [ ] **G3 ⇐ E3,F3,G1** Test de guardado del teléfono: tras corregir con `" 8888-9999 "`, la
      columna guarda `"8888-9999"` (recortado, **no** `"50688889999"`), igual que la carga.
      _Hecho:_ verde en el test de integración de B3. **(R19)**
- [ ] **G4 ⇐ todo lo anterior** `progress/impl_312.md` con el mapa `R<n> → test` **completo** y
      **commiteado** (un informe sin commitear se pierde con el primer `git checkout`).
      _Hecho:_ los 32 requisitos tienen su archivo y su nombre de test; ninguno sin cubrir.
- [ ] **G5 ⇐ G4** `./init.sh --rapido` verde, con `INIT_EXIT` escrito **dentro** del log.
      _Hecho:_ typecheck 0, lint 0, tests relacionados verdes y **todas** las guardias verdes
      (en especial `orden-nota-frontera`, `novedad-acciones-una-tabla`,
      `novedad-acciones-sin-maqueta`, `superficie-de-uso`).
- [ ] **G6 ⇐ G5** Repaso a mano en la app (la suite no encuentra lo que ver la app sí): corregir
      una orden como `maestro` desde `/ordenes` y como `adminTienda` desde `/novedades`, y
      comprobar en la propia pantalla que la nota aparece en el hilo con autor y hora.
      _Hecho:_ capturas o notas del recorrido en `progress/impl_312.md`.
      ⚠️ **Ojo:** con la P1 sin responder, el `maestro` **no puede leer el hilo**, así que este
      repaso solo verá la nota desde la sesión de la tienda. Si eso resulta inaceptable al verlo,
      es la señal de que P1 hay que resolverla antes de cerrar.

---

## Mapa requisito → test

| Req | Dónde se prueba |
| --- | --- |
| R1 | A2 (`correccion-datos-cliente-schema.test.ts`) |
| R2 | A2, D2 |
| R3 | A2, D2 |
| R4 | C2 («valores idénticos ⇒ cambios vacío, cero escrituras») |
| R5 | B3 caso 5 (comparación fila-a-fila contra Postgres) |
| R6 | D2 («sin sesión ⇒ unauthenticated, servicio no construido») |
| R7 | A1, C2 |
| R8 | A1, C2 (cuatro casos de `adminTienda`) |
| R9 | A1, C2 |
| R10 | A1, C2, B3 caso 2 |
| R11 | C2 («inexistente, borrada y ajena devuelven el mismo objeto»), B3 caso 3 |
| R12 | B3 caso 2, C2 («repo devuelve conflict») |
| R13 | A3, B3 caso 1, C2 («el cuerpo nombra solo lo que cambió»), C3 |
| R14 | B3 caso 1, C2 («autorId/rolAutor del actor») |
| R15 | B3 caso 4 (`orden_historial_estado` no aumenta) |
| R16 | B3 casos 1 y 6 (la transacción revierte) |
| R17 | A3 (`producto` de 500 caracteres ⇒ exactamente `CUERPO_MAX`, acaba en `…`) |
| R18 | D3 (detector reusado + contraprueba) |
| R19 | G3 |
| R20 | C2 (`telefonoDest: "abc"` ⇒ validation_error) |
| R21 | G1 (la fila vieja sigue intacta), G2 (no se llama a `migrarTelefono`) |
| R22 | G1 |
| R23 | G1 |
| R24 | E3 |
| R25 | F1 (guardias), F3 |
| R26 | A1 (`undefined`/`null` ⇒ false), E3 |
| R27 | D2, y por construcción en C2 (el servidor decide con el actor, no con el input) |
| R28 | E3 |
| R29 | E3 (`numGuia` con y sin valor) |
| R30 | E3 (teléfono tocado y sin tocar) |
| R31 | E3, F3 |
| R32 | E3 |

---

## Riesgos anotados

- **Base local compartida entre worktrees.** No hay migración en esta ficha, así que el riesgo
  habitual (una migración de otra feature poniendo rojo este gate) no lo genera esta rama — pero
  sí lo puede sufrir. Si `prisma migrate status` señala otra base, parar.
- **`prisma generate` se pisa entre worktrees.** Si el typecheck falla en archivos generados,
  `rm -rf .next/dev` y regenerar antes de creerse el rojo.
- **`dev` se mueve.** Antes de abrir el PR, comparar el SHA medido en G5 con `origin/dev`.
- **P1–P4 y T1–T3 sin responder.** El bloque G6 depende de P1. No se cierra la ficha con esas
  preguntas abiertas: se llevan a la puerta de aprobación **antes** de empezar el bloque A.
