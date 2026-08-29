# Ficha 332 — Eliminar plantillas de gasto fijo · requirements

> **Estado:** borrador para la puerta de aprobación humana (F1.4).
> **Zona:** `fullstack` · **Complejidad:** baja · **`depends_on`:** 85 (ver Preguntas abiertas).
> **Revoca:** la decisión «sin borrado» de la ficha 45 (`45/R25`), con OK humano del 2026-08-29.

## 0. Contexto verificado (no supuesto)

Lo siguiente se confirmó leyendo el árbol el 2026-08-29, archivo por archivo, no por el índice
del grafo:

| Afirmación | Dónde se confirmó |
| --- | --- |
| El servicio de plantillas **no tiene** método de borrado | `lib/services/GastoFijoPlantillaService.ts` (6 métodos: crear, actualizar, setActiva, listar, listarCompleto, listarPaginado) |
| El repositorio **no expone** `delete` | `lib/repositories/GastoFijoPlantillaRepository.ts` + `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts:7-8` |
| El único recurso del usuario es desactivar | `GastosFijosPlantillasPanel.tsx` → botón «Desactivar» → `setActivaPlantillaAction` |
| `wallet_movimiento` **no tiene FK** a `gasto_fijo_plantilla` | `db/schema.prisma` — `WalletMovimiento` (l. 1509-1528) no declara relación; `GastoFijoPlantilla` (l. 1836-1849) no declara **ninguna** relación |
| La referencia es **derivada** | `GeneracionGastosFijosService.ts:64` → `origenId: \`${p.id}:${periodo}\`` con `origenTipo: "gasto"` |
| El movimiento **se explica solo** sin la plantilla | `GeneracionGastosFijosService.ts:65` → `descripcion: \`${p.concepto} — ${periodo}\`` |
| La tabla tiene **RLS habilitada sin policies** (solo service role) | `db/migrations/20260713150000_gasto_fijo_plantilla/migration.sql:28` — un `DELETE` por Prisma (service role) no necesita policy nueva ni migración |

**Medición contra producción (2026-08-29, tomada de la ficha, NO re-medida en esta sesión):**
2 plantillas — «Alquiler bodega» ₡10.000 y «Alquiler camioneta» ₡25.000 —, las dos inactivas
desde el 2026-08-27, y **cero** movimientos de categoría `egreso_gasto_fijo` en el libro. Hoy no
hay ni un histórico que proteger; el mecanismo nunca ha cobrado nada.

## 1. Glosario

- **Acceso total** — rol `maestro` o `admin`, según `esAccesoTotal` (`lib/auth/acceso-total.ts`).
  Es la misma guardia que ya usan los cinco métodos del CRUD de plantillas.
- **Plantilla** — fila de la tabla `gasto_fijo_plantilla` (configuración recurrente, mutable).
- **Libro** — `wallet_movimiento`: append-only e inmutable (la fila no lleva `updatedAt` ni
  `deletedAt`; `db/schema.prisma:1520` lo declara).
- **Cobro pendiente** — el objeto que introducirá la ficha 333. Hoy **no existe**.

---

## 2. Requisitos

### A · El borrado

- **R1** — El sistema DEBE ofrecer a un usuario con acceso total una forma de ELIMINAR una
  plantilla de gasto fijo existente.

- **R2** — CUANDO un usuario con acceso total confirma la eliminación de una plantilla existente,
  el sistema DEBE borrar su fila de `gasto_fijo_plantilla` y DEBE dejar de incluirla en el
  listado de plantillas.

- **R3** — CUANDO el sistema elimina una plantilla, DEBE eliminar EXACTAMENTE la fila
  identificada y NO DEBE eliminar ninguna otra.

- **R4** — SI el actor no tiene acceso total, ENTONCES el sistema DEBE rechazar la eliminación
  como prohibida y NO DEBE borrar ninguna fila.

- **R5** — SI la petición llega sin sesión, ENTONCES el sistema DEBE rechazarla como no
  autenticada y NO DEBE llegar a evaluar la eliminación.

- **R6** — SI la entrada no identifica una plantilla con un identificador válido, o trae claves
  desconocidas, ENTONCES el sistema DEBE rechazarla como error de validación en el borde y NO
  DEBE llegar a evaluar la eliminación.

- **R7** — SI la plantilla identificada ya no existe cuando se ejecuta el borrado, ENTONCES el
  sistema DEBE responder «no encontrada», sin efectos secundarios y sin error no controlado.

### B · El histórico del libro

- **R8** — El sistema NO DEBE crear, modificar ni eliminar ningún movimiento de `wallet_movimiento`
  como consecuencia de eliminar una plantilla.

- **R9** — MIENTRAS existan movimientos `egreso_gasto_fijo` originados por una plantilla ya
  eliminada, el sistema DEBE seguir listándolos en el libro con su `monto`, su `fecha_movimiento`,
  su `origen_id` y su `descripcion` sin cambios; la descripción DEBE seguir llevando el concepto y
  el periodo, de modo que la fila se explique sola sin la plantilla.

- **R10** — El sistema DEBE derivar la clave de idempotencia del cron del identificador de la
  plantilla; en consecuencia, una plantilla creada DESPUÉS de eliminar otra DEBE tratarse como
  una plantilla distinta, con clave distinta.
  *(Es lo que ya hace `GeneracionGastosFijosService`; se fija aquí como requisito porque el
  borrado hace visible su consecuencia: borrar y volver a crear el mismo concepto puede cobrar
  otra vez un periodo ya cobrado. Ver `design.md §7 Riesgos`.)*

### C · Pausar sigue existiendo

- **R11** — El sistema DEBE conservar la acción de activar/desactivar una plantilla con su
  comportamiento actual: desactivar detiene la generación futura y NO DEBE eliminar la fila.

### D · La confirmación

- **R12** — CUANDO un usuario con acceso total pide eliminar una plantilla, el sistema DEBE
  pedir una confirmación explícita antes de ejecutar el borrado.

- **R13** — MIENTRAS la confirmación no haya sido aceptada, el sistema NO DEBE eliminar la
  plantilla.

- **R14** — La confirmación DEBE identificar la plantilla por su concepto y su monto, y el monto
  DEBE presentarse a partir del valor STRING que entrega el servidor, sin convertirlo a número.

- **R15** — La confirmación DEBE enunciar las tres consecuencias del borrado: (a) la plantilla
  desaparece de la tabla de plantillas, (b) deja de generar cobros, y (c) los cobros ya hechos
  siguen en el libro y no se tocan.

- **R16** — La confirmación DEBE ofrecer al usuario la alternativa de sólo PAUSAR (desactivar)
  en vez de eliminar.

- **R17** — CUANDO el usuario cancela la confirmación, el sistema NO DEBE eliminar nada.

### E · Lo que ve el usuario después

- **R18** — CUANDO la eliminación termina con éxito, el sistema DEBE releer el listado visible y
  DEBE avisar al usuario de que la plantilla se eliminó.

- **R19** — SI la eliminación falla, ENTONCES el sistema DEBE avisar al usuario con un mensaje
  distinto para cada caso (sin permiso, sin sesión, no encontrada, error de validación) y DEBE
  dejar el listado mostrando el estado que devuelve el servidor.

- **R20** — CUANDO una eliminación con éxito deja sin filas la página visible del listado y esa
  página no es la primera, el sistema DEBE mostrar la página anterior.

### F · La revocación de `45/R25` («sin borrado»)

- **R21** — El sistema NO DEBE conservar, en el árbol de producción, ninguna afirmación vigente de
  que las plantillas de gasto fijo no se pueden borrar.

- **R22** — Los contratos vivos que afirmaban `45/R25` DEBEN declarar su revocación con la fecha
  (2026-08-29), el motivo (la tabla acumula ruido; el histórico vive en el libro y no depende de
  la plantilla) y un puntero a `specs/332-eliminar-plantilla-gasto-fijo`.

- **R23** — El spec de la ficha 45 DEBE llevar un apéndice que apunte a esta ficha con fecha, y
  el texto original de `45/R25` DEBE conservarse verbatim: el apéndice se AÑADE, no reescribe.

- **R24** — El sistema NO DEBE modificar el SQL ya aplicado de la migración
  `20260713150000_gasto_fijo_plantilla`; su nota «NO se borra (R25)» DEBE leerse como la foto de
  su fecha y NO DEBE contar como afirmación vigente a efectos de R21.

### G · El traspaso a la ficha 333

- **R25** — El sistema DEBE dejar escrito, en el contrato del servicio de eliminación y en el
  diseño de esta ficha, que al eliminar una plantilla con cobros pendientes de aprobación (ficha
  333) esos cobros DEBEN cancelarse y su número DEBE aparecer en la confirmación antes de borrar.

- **R26** *(diferido — comportamiento propiedad de la ficha 333)* — DONDE exista el mecanismo de
  cobros pendientes de aprobación de la ficha 333, el sistema DEBE cancelar los cobros pendientes
  de la plantilla en la misma operación que la elimina, y la confirmación DEBE anunciar su número
  («Se cancelarán 2 cobros pendientes») ANTES de que el usuario acepte.

---

## 3. Trazabilidad `R<n>` → test

Nombres de archivo propuestos; el implementer los confirma en `progress/impl_332.md`.

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| R1 | «el panel ofrece un botón Eliminar por fila» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R2 | «acceso total → borra la fila y devuelve ok» + «tras eliminar, la fila deja de listarse» | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` · `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R3 | «eliminar filtra por el id exacto y por ninguna otra columna» | `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` |
| R4 | «rol sin acceso total → forbidden, sin llamar al repositorio» | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R5 | «sin sesión → unauthenticated, sin tocar el service» | `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` |
| R6 | «id que no es uuid → validation_error» + «clave desconocida → validation_error» | `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` |
| R7 | «id inexistente → not_found, sin lanzar» | `tests/unit/services/gasto-fijo-plantilla-service.test.ts` |
| R8 | «eliminar no toca ninguna tabla que no sea gasto_fijo_plantilla» (doble de Prisma que revienta ante cualquier otro modelo) | `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` |
| R9 | «borrada la plantilla, su egreso sigue en el libro con monto, fecha, origen_id y descripción intactos» (Postgres real) | `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` |
| R10 | «el origen_id deriva del id de la plantilla: dos plantillas distintas con el mismo concepto producen claves distintas» | `tests/integration/db/generacion-gastos-fijos.test.ts` (caso nuevo) |
| R11 | «Desactivar sigue llamando a setActiva y la fila sigue en la tabla» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R12 | «Eliminar abre la confirmación y NO llama a la acción» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R13 | idem R12 (misma aserción: la acción no se llamó antes de confirmar) | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R14 | «la confirmación nombra el concepto y pinta ₡10.000 desde el STRING» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R15 | «la confirmación enuncia las tres consecuencias» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R16 | «la confirmación menciona la alternativa de desactivar» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R17 | «Cancelar cierra sin llamar a la acción» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R18 | «tras ok, relee la página y muestra el aviso de éxito» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R19 | «cada estado de error muestra su propio mensaje» (4 casos) | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R20 | «borrada la última fila de la página 2, el panel pide la página 1» | `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` |
| R21 | «(a) ningún archivo vivo afirma que las plantillas no se borran» | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |
| R22 | «(b) la revocación está escrita con fecha, motivo y puntero, en los contratos censados» | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |
| R23 | «(c) specs/45 lleva el apéndice y (d) su texto original sigue verbatim» | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |
| R24 | «(e) el SQL aplicado de la migración no se tocó y queda fuera del censo, con su motivo escrito» | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |
| R25 | «(f) el traspaso a la 333 está escrito en el contrato del servicio y en el design» | `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` |
| R26 | **SIN test en esta ficha, y es deliberado.** La prueba de comportamiento la debe la ficha 333, que es la dueña de la tabla de pendientes. Lo único que la 332 afirma hoy es R25 (que el contrato quede escrito). |

---

## 4. Fuera de alcance

- Crear, esquematizar o mencionar el esquema de la tabla de cobros pendientes de la ficha 333.
- Papelera, soft-delete, `deleted_at`, historial de plantillas borradas o cualquier modelo nuevo.
  El humano pidió que **la fila desaparezca** de la tabla de plantillas.
- Tocar el libro, sus reversas o el cron de generación (más allá del caso de test de R10).
- Borrado masivo o por selección múltiple: se elimina de a una, desde su fila.
- La periodicidad y la fecha de cobro en la UI: eso es la ficha 85.

---

## 5. Preguntas abiertas

1. **`depends_on: 85` con la 85 en `pending`.** La ficha 332 declara `depends_on: 85`, y la 85
   sigue `pending` (verificado en `feature_list.json:944`). El borrado **no necesita nada** de la
   85: ni periodicidad, ni fecha de cobro, ni backend nuevo. Lo que sí hay es **conflicto de
   archivos**: las dos tocan `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` y
   `GastoFijoPlantillaDialog.tsx`, y la 85 además va a quitarle los defaults al schema de
   ACTUALIZAR. ¿Se mantiene el bloqueo por secuencia (85 → 332) o se libera la 332 asumiendo que
   quien vaya segundo resuelve el conflicto? *(No lo decido yo: cambia el orden del backlog.)*

2. **¿Quién puede eliminar: `maestro` y `admin`, o sólo `maestro`?** El encargo dice «el mismo
   guard de rol que el resto del CRUD, `esAccesoTotal`», que hoy incluye a **admin** por la
   paridad que introdujo la feature 94. Esta spec asume `esAccesoTotal` (maestro + admin). Si el
   humano quiere que **borrar** sea más estrecho que **editar**, hay que decirlo aquí: sería la
   primera asimetría de rol dentro de este CRUD.

3. **¿Se pide confirmación reforzada?** La spec pide una confirmación explícita con botón
   destructivo (R12–R17). No pide teclear el concepto para confirmar. Con 2 plantillas en
   producción y cero histórico que perder, escribir el nombre parece caro; si el humano prefiere
   la fricción extra, es un cambio de una línea en R12.

4. **El aviso de éxito, ¿ofrece deshacer?** No hay deshacer: la fila se borra de verdad. Se avisa
   con un toast y punto. Si se quisiera un «deshacer» habría que guardar la fila en algún sitio,
   que es exactamente el soft-delete que esta ficha descarta.

5. **R20 (volver a la página anterior) no está en el encargo.** Lo añadí porque con paginación
   server-side borrar la última fila de una página deja una tabla vacía sin explicación — un
   fallo mudo de los baratos. Con 2 plantillas y páginas de 25 hoy **no puede ocurrir**. Si se
   considera fuera de alcance, es un requisito que se tacha entero sin tocar los demás.
