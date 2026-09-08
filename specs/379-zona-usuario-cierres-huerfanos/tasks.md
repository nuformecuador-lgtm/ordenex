# Ficha 379 — Tasks

**Rama:** `fix/379-zona-usuario-cierres-huerfanos` (creada, **sin commits**). **Zona:** fullstack,
secuenciada backend → frontend. **Worktree aislado.**

---

## Antes de empezar: cuatro cosas medidas

**1. El gate rápido se va a negar.** `init.sh:134-135`: el diff toca `lib/types/usuario.ts`
(`^lib/types/` ∈ `RUTAS_SENSIBLES`) y `lib/{interfaces/repositories,repositories}/CierreBodega*.ts`
(`cierre` ∈ `NOMBRES_DE_DINERO`). **`./init.sh` completo, y es un `fail`, no un aviso.** Presupuestar
5-11 min para el PR desde el principio.

**2. Esta ficha NO lleva migración**, así que no puede poner rojo el gate de nadie. Al revés sí: si
otra rama aplica una migración sobre la base local **compartida**, el gate de aquí se cae por una
tabla que no existe. Antes de culpar al código: `prisma migrate deploy` y `prisma generate`.

**3. Conflicto de archivos: ninguno conocido.** Los ficheros de esta ficha (`UsuarioService.ts`,
`UserRepository.ts`, `IUserRepository.ts`, `ICierreBodegaRepository.ts`, `CierreBodegaRepository.ts`,
`lib/types/usuario.ts`, `lib/actions/usuarios.ts`, `UsuarioForm.tsx`, `UsuariosModule.tsx`) no los
toca la 376 (`ZonaRepository`/`zona.ts`) ni la 383 (`BulkOrdenService`/`CorregirDatosClienteService`).
**Comprobar igualmente contra `origin/dev`**, no contra el árbol local: el pre-vuelo caduca.

**4. Si ya hay un dev server de otro agente, no se levanta otro.** Comparten `.next` y se tumban
aunque el puerto sea distinto.

## Convención de "hecho"

Una task está terminada cuando: compila (`tsc` strict, sin `any` nuevo), pasa lint, **su test existe
y se pone ROJO con la mutación escrita en la propia task**, y —si toca un `WHERE`— está medida contra
Postgres real (`tests/integration/db`), no contra un doble. Un test de integración que no falla sin
datos no cuenta: nada de `if (!fks) return;`.

Un commit por task (`fix(379): …` / `test(379): …`), no un mega-commit al final.

---

# BLOQUE A — la zona sigue al rol (R1-R8) · **puede aterrizar solo**

## T1 — `actualizar` recalcula la zona cuando cambia el rol

**Depende de:** nada.

- [ ] `lib/services/UsuarioService.ts:259` — la condición pasa a
      `if (input.zonaId !== undefined || input.rolId !== undefined)` y el deseado a
      `input.zonaId !== undefined ? input.zonaId : actual.zonaId`. **Forma idéntica** a la del
      vehículo en `:271`, que está doce líneas más abajo en el mismo método.
- [ ] **NO se toca `resolverZona`** (`:448-473`) ni `crear` (`:98-101`) ni `ZONA_ROLES` (`:42`).
- [ ] Comentario corto encima citando la ficha y el porqué: la zona y el vehículo son campos
      hermanos con la misma invariante por rol; tenerlos con dos reglas fue el defecto.
- [ ] Tests nuevos en `tests/unit/services/usuario-zona.test.ts`, dentro del `describe` que ya
      existe (`"actualizar — zona por rol (R27/R28)"`), con nombres de comportamiento:
  - `R1` · «cambiar el rol de adminSatelite a admin deja la zona en null aunque no se envíe zonaId»
  - `R2` · «cambiar el rol de mensajero a adminSatelite sin enviar zonaId conserva la zona actual»
  - `R3` · «cambiar a un rol con zona sin tener ninguna devuelve validation_error en zonaId y no escribe»
  - `R4` · «alta y edición resuelven la MISMA zona efectiva para el mismo par (rol, zona)» —
    recorriendo los tres roles del fixture, no con tres casos escritos a mano
  - `R7` · «editar solo el nombre no incluye zonaId en los datos de actualización» *(este ya existe
    en `:164-169`: **no se edita**, se comprueba que sigue verde)*

**Mutaciones (obligatorias, con su resultado esperado):**
| Mutación | Debe ponerse rojo |
| --- | --- |
| Volver la condición a `input.zonaId !== undefined` | R1, R5 (integración) |
| `const deseado = input.zonaId ?? null` | R2 |
| Devolver `{ ok: true, zonaId: null }` en la rama `required` | R3 |
| Sustituir `this.resolverZona(...)` de esa rama por un literal local | R4 |
| Entrar siempre en la rama (quitar la condición entera) | R7 |

**Hecho cuando:** los 5 casos verdes, las 5 mutaciones rojas, y `usuario-zona.test.ts` no tiene
ninguna aserción **borrada**.

## T2 — El `toEqual` literal que esta ficha cambia a propósito

**Depende de:** T1.

- [ ] `tests/unit/services/usuario-service.test.ts:170-175` — el literal pasa a
      `{ nombre: "Nuevo", rolId: "rol-2", fulfillment: false, vehiculoId: null, zonaId: null }`.
- [ ] En el comentario que ya explica el vehículo, añadir la línea de la zona: **por qué** `zonaId`
      aparece ahora (rol-2 no lleva zona → se fuerza null, ficha 379/R1).
- [ ] **PROHIBIDO** relajarlo a `toMatchObject`, a `expect.objectContaining` o a una comparación
      derivada de `data`: ese literal **es** el contrato de «qué campos escribe una edición», y
      cambiarlo por su propia fuente lo deja verde para siempre.

**Hecho cuando:** el caso pasa, y quitando `zonaId: null` del literal **se pone rojo** (prueba de que
el campo se escribe de verdad y no de que la aserción se aflojó).

## T3 — El rastro llega a la base (R5/R6) `[P]` con T2

**Depende de:** T1.

- [ ] Caso nuevo en `tests/integration/db/historial-accion-atomicidad.test.ts` (o el archivo hermano
      que ya cubre `usuario_zona_cambiada`; **no crear uno nuevo si ya hay sitio**):
  - `R5` · cambiar el rol de un `adminSatelite` **con zona** a `admin`, **sin enviar zonaId**, escribe
    `usuario_zona_cambiada` con `valor_anterior = <nombre de la zona>` y `valor_nuevo = NULL`, y
    **comparte `lote_id`** con la fila `usuario_rol_cambiado` del mismo acto.
  - `R6` · editar solo el teléfono de un usuario **que tiene zona** no escribe ninguna fila de zona.
- [ ] Los datos los crea el propio test y **falla ruidosamente** si el catálogo no está sembrado.

**Mutaciones:** revertir T1 → R5 rojo (hoy no se escribe nada). Forzar `data.zonaId = null` en toda
edición → R6 rojo.

**Hecho cuando:** los dos casos verdes contra Postgres real, las dos mutaciones rojas.

> **Corte de seguridad:** con T1+T2+T3 en verde, el Bloque A es mergeable por sí solo. Si el Bloque B
> se complica, se abre PR aquí y D2 queda cerrada.

---

# BLOQUE B — el aviso (R9-R23)

## T4 — El resumen del dinero atrapado, **sobre el `WHERE` que ya existe** `[P]` con T5

**Depende de:** nada.

- [ ] `lib/interfaces/repositories/ICierreBodegaRepository.ts`: `ResumenConsolidablesPendientes`
      (`{ cantidad: number; totalGeneral: string }`) + `resumirConsolidablesPendientes(zonaId)`, con
      el docstring de `design.md` §4.1.
- [ ] `lib/repositories/CierreBodegaRepository.ts`: implementación con
      `aggregate({ where: consolidablesWhere(zonaId), _count, _sum })`. **Reusa `consolidablesWhere`
      (`:147`), no una copia.** `_sum` nulo → `"0.00"`. Money-safe: `Prisma.Decimal.toFixed(2)`,
      nunca `Number`/`parseFloat`.
- [ ] Test en `tests/integration/db/` (archivo nuevo `cierre-bodega-resumen-pendientes.test.ts` si no
      hay sitio natural):
  - `R18` · sobre el MISMO dataset, `resumirConsolidablesPendientes` devuelve exactamente la cuenta y
    la suma de lo que `findCierresDiaConsolidables` lista — **comparación cruzada de las dos
    lecturas**, no contra números escritos a mano.
  - `R18` · un `cierre_dia` ya consolidado (`cierre_bodega_id` no nulo), uno `solicitado`, uno de
    otra zona y uno con destino central **no** entran.
  - `R19` · un importe de once dígitos con céntimos vuelve exacto como `string`.

**Mutación:** cambiar `cierreBodegaId: null` por `{}` dentro de `consolidablesWhere` → **rojo en los
dos** (el del resumen y el de la consolidación), que es la prueba de que comparten criterio.

**Hecho cuando:** verde contra Postgres real y la mutación tumba las dos lecturas.

## T5 — El recuento de administradores de bodega `[P]` con T4

**Depende de:** nada.

- [ ] `lib/interfaces/repositories/IUserRepository.ts` + `lib/repositories/UserRepository.ts`:
      `contarAdminSatelitesActivos(zonaId, excluirUsuarioId)`. Corte **en el `WHERE`**
      (`rol: { value: "adminSatelite" }`, `estado: "activo"`, `zonaId`, `id: { not }`), nunca en
      memoria. Devuelve número; no proyecta ni una columna de persona (R22).
- [ ] Test en `tests/integration/db/`:
  - `R17` · no se cuenta a sí mismo; no cuenta inactivos; no cuenta otras zonas; no cuenta otros roles.

**Mutaciones:** quitar `id: { not: … }` → rojo; quitar `estado: "activo"` → rojo; quitar el filtro de
rol → rojo.

**Hecho cuando:** los cuatro cortes verdes y las tres mutaciones rojas.

## T6 — Contratos del servicio `[P]` con T4/T5

**Depende de:** nada (solo tipos).

- [ ] `lib/interfaces/services/IUsuarioService.ts`: `CambioUsuarioEvaluable`,
      `ImpactoSalidaAdminSatelite`, `ConsultarImpactoCambioServiceResult` y la firma en
      `IUsuarioService`, con los docstrings de `design.md` §4.3.
- [ ] `ActualizarUsuarioServiceResult` y `CambiarEstadoUsuarioServiceResult` **no se tocan**: esta
      ficha **no** añade ninguna rama de bloqueo (R14).

**Hecho cuando:** `tsc` limpio; `git diff` de este archivo no toca ninguno de los dos unions de
escritura.

## T7 — `UsuarioService.consultarImpactoCambio`

**Depende de:** T4, T5, T6 (y T1: comparte el helper de zona resultante).

- [ ] Implementar los 7 pasos de `design.md` §4.3, **en ese orden** (permiso antes de leer nada).
- [ ] Extraer el helper privado que responde «¿qué rol/zona/estado le quedan tras este cambio?» y
      usarlo **también** desde `actualizar` (T1). Una regla, un sitio.
- [ ] Sexto parámetro del constructor: `ICierreBodegaRepository` opcional que **LANZA** con mensaje
      explícito si `consultarImpactoCambio` se ejecuta sin él (patrón de `sessionRepo`, `:369-377`).
      Nunca devolver «no hay dinero» cuando lo que pasa es que no se puede leer.
- [ ] Tests en `tests/unit/services/usuario-impacto-zona.test.ts` (dobles, sin DB):
  - `R9`/`R10` · adminSatelite activo único de Z + cambio de rol → impacto con zona, cuenta e importe
  - `R10` · lo mismo cambiando la zona, y lo mismo pasando a `inactivo` — **los tres casos, uno por
    puerta (D1/D2/D3)**
  - `R15` · con otro adminSatelite activo en Z → `impacto: null`
  - `R16` · usuario `mensajero` → `impacto: null`; usuario sin zona → `impacto: null`;
    usuario adminSatelite **ya inactivo** → `impacto: null`
  - `R15` · cambio a `estado: "activo"` → `impacto: null`
  - `R17` · el excluido del recuento es el usuario evaluado (se afirma el argumento del doble)
  - `R22` · actor no maestro → `forbidden` sin haber llamado a ningún repo; y el objeto devuelto no
    contiene `email`, `telefono` ni `cedula`
  - inyección ausente → **lanza**, no devuelve ceros

**Mutaciones:** invertir el `> 0` del recuento → R15 rojo; quitar el filtro de rol del paso 4 → R16
rojo; mover el guard de permiso detrás de la lectura → R22 rojo; devolver `{cantidad:0,total:"0.00"}`
cuando falta el repo → el caso de inyección rojo.

**Hecho cuando:** todos verdes y las cuatro mutaciones rojas.

## T8 — El borde (Server Action + schema)

**Depende de:** T7.

- [ ] `lib/types/usuario.ts`: `consultarImpactoCambioUsuarioSchema` **derivado** de
      `actualizarUsuarioSchema.pick({rolId, zonaId})` + el `estado` de
      `cambiarEstadoUsuarioSchema`, `.strict()`. Y `ConsultarImpactoCambioUsuarioResult`.
      **`actualizarUsuarioSchema` no gana ni un campo.**
- [ ] `lib/actions/usuarios.ts`: `consultarImpactoCambioUsuario(id, cambio, deps)` con el patrón
      idéntico a las otras ocho (`withErrorHandler` + `resolveActorFromSession` + `idSchema` +
      `toUsuarioActionError`). `buildUsuarioService()` construye y pasa `CierreBodegaRepository`.
- [ ] Tests en `tests/unit/actions/usuarios.test.ts`: sin sesión → `unauthenticated` **antes** de
      tocar el service; `id` inválido → `validation_error`; clave desconocida en `cambio` →
      `validation_error` (prueba del `.strict()`).

**Hecho cuando:** verde, y `tests/unit/types/usuario-schema.test.ts` sigue verde **sin editarlo**.

## T9 — El formulario expone el cambio pendiente `[P]` con T8

**Depende de:** T6.

- [x] `UsuarioForm.tsx`: `UsuarioFormHandle` gana `cambioPendiente()`, apoyado en el `validate()` que
      ya existe (`:195-273`). **Cero reglas duplicadas.** Devuelve `null` en modo crear y cuando la
      validación de cliente falla (el maestro ya está viendo el error de campo).
- [x] Test en `tests/unit/components/usuario-form.test.tsx`: lo devuelto coincide **campo a campo**
      con lo que el mismo formulario enviaría a `actualizarUsuario` (mismo criterio de `esRolConZona`
      de `:235`).

**Mutación:** hacer que devuelva `{rolId}` sin `zonaId` → rojo.

## T10 — Que el repositorio de cierres **se pasa de verdad**

**Depende de:** T8.

- [ ] Extender `tests/unit/actions/usuarios-composition.test.ts`: `buildUsuarioService()` construye
      el servicio **con** el repositorio de cierres en la posición correcta.
- [ ] Motivo escrito en el test: el parámetro es opcional, así que olvidarlo **no rompe el
      typecheck** y el aviso saldría a producción lanzando en cuanto alguien pulsara el botón.

**Mutación:** quitar el argumento del composition root → rojo.

## T11 — La pantalla

**Depende de:** T8, T9.

- [x] `UsuariosModule.tsx`: estado del aviso + acción diferida + `Modal` (el compartido, con el texto
      en `description` para que cuelgue de `aria-describedby`), y los dos puntos de llamada de
      `design.md` §4.5.
- [x] Copy **exacto** de `design.md` §4.6. Etiqueta del rol desde `ROL_LABELS`
      (`lib/auth/rol-label.ts`), importe con `formatMontoString` (`lib/config/moneda.ts:282`).
      Singular/plural en función pura, al lado de `mensajeSesionesRevocadas` (`:496-504`).
      ⚠️ **Con TRES desvíos del copy, decididos por el frontend_dev de la tanda y escritos con su
      vuelta atrás en `progress/impl_379_frontend.md` > «Las tres decisiones que tomé YO»:**
      (D1) «un admin» pasa a «un Administrador» y «el maestro» a «el Maestro», los tres roles
      desde `ROL_LABELS`, porque `admin` **es** el valor del enum y R23 lo prohíbe;
      (D2) la rama de R20 lleva título propio, porque el del §4.6 afirma lo que ahí no se sabe;
      (D3) en esa misma rama la zona se nombra con lo que pinta la fila, porque el servidor no
      llegó a decirlo.
- [x] Tests en `tests/unit/components/usuarios-module.test.tsx` (o
      `usuarios-aviso-zona.test.tsx` si el archivo crece demasiado):
  - `R9`/`R21` · la consulta se llama **antes** que `cambiarEstadoUsuario`, y antes que
    `actualizarUsuario` — se afirma el **orden**, no solo que se llamó
  - `R10` · el diálogo dice el nombre de la zona, el número de cierres y el importe formateado
  - `R11` · con el diálogo abierto, **cero** llamadas a la acción de escritura
  - `R12` · confirmar llama a la acción con **los mismos argumentos exactos** que sin aviso
  - `R13` · cancelar → cero llamadas a la escritura, y el diálogo se cierra
  - `R15` · sin impacto (`impacto: null`) → se aplica directo, **sin diálogo** y con los mismos clics
  - `R20` · la consulta devuelve error → aparece el diálogo del §4.6 y **confirmar aplica el cambio**
  - `R23` · el diálogo dice «Admin satélite» y **no** contiene el literal `adminSatelite`

**Mutaciones:** aplicar el cambio antes de abrir el diálogo → R11 rojo; devolver siempre
`impacto: null` desde el doble → R10 rojo; tragarse el error de la consulta y aplicar → R20 rojo;
escribir el literal del rol → R23 rojo.

## T12 — La guardia de que **nada bloquea al maestro** (R14)

**Depende de:** T7, T11.

- [ ] Test de servicio: con dinero pendiente y **cero** administradores restantes, `actualizar` y
      `cambiarEstado` devuelven `ok` y escriben — es decir, los caminos de **escritura** no consultan
      el impacto ni miran el repositorio de cierres.
- [ ] Guardia estática (`tests/unit/guards/379-maestro-sin-bloqueo.guardia.test.ts`) sobre
      `UsuarioService.ts` **sin comentarios** (`tests/fixtures/sin-comentarios.ts`, el quitador único
      del repo): los cuerpos de `actualizar` y `cambiarEstado` no mencionan el repositorio de cierres
      ni `consultarImpactoCambio`. **Con contraprueba**: aplicar la mutación en memoria y exigir que
      la aserción la cace (una guardia estática rota no falla, calla).

**Mutación:** añadir en `cambiarEstado` una rama que devuelva `conflict` cuando hay dinero pendiente
→ los dos rojos.

**Hecho cuando:** los dos verdes, la mutación roja y la contraprueba de la guardia incluida.

---

# CIERRE

## T13 — Ver la app, no solo la suite

**Depende de:** T11.

- [x] Entrar a Configuración > Usuarios con un maestro y, contra datos locales sembrados:
      (a) inactivar al único administrador de bodega de una zona → **ver el diálogo**, cancelarlo,
      repetir y confirmarlo; (b) cambiarle el rol; (c) cambiarle la zona; (d) hacer lo mismo con una
      zona que tiene dos → **no debe aparecer nada**.
- [x] Comprobar el texto con los ojos: acentos, plural, el importe con su símbolo, y que no aparece
      ni `adminSatelite` ni ninguna sigla.

**Hecho cuando:** los cuatro casos vistos en pantalla y anotados en `progress/impl_379.md` con lo que
se vio, no con lo que se esperaba. *(RS2: nadie ha visto este diálogo fuera de jsdom.)*

## T14 — Gate completo y PR

**Depende de:** todo.

- [ ] `./init.sh` **completo** (el rápido se niega, §9 del design). Escribir `INIT_EXIT=$?` **dentro**
      del log: un `echo` posterior tapa el código de salida.
- [ ] Mirar los `skipped`, no solo el `INIT_EXIT`: sin `.env` se saltan ~78 archivos de
      `integration/db` y el gate dice «OK» igual. Los tests de T3, T4 y T5 **tienen que haber
      corrido**.
- [ ] `progress/impl_379.md` con el mapa R→test completo, y **commitearlo** (un informe sin commitear
      se lo lleva el primer `git checkout`).
- [ ] PR a `dev`. Marcar en la descripción que el Bloque A es independiente, por si hay que partirlo.

---

## Mapa de trazabilidad R → test

| R | Test | Task |
| --- | --- | --- |
| R1 | `usuario-zona.test.ts` «cambiar el rol a admin deja la zona en null…» + `usuario-service.test.ts:170` (literal) | T1, T2 |
| R2 | `usuario-zona.test.ts` «…sin enviar zonaId conserva la zona actual» | T1 |
| R3 | `usuario-zona.test.ts` «…devuelve validation_error en zonaId y no escribe» | T1 |
| R4 | `usuario-zona.test.ts` «alta y edición resuelven la MISMA zona efectiva» | T1 |
| R5 | `integration/db` historial: `usuario_zona_cambiada` con `valor_anterior` y `lote_id` compartido | T3 |
| R6 | `integration/db` historial: editar el teléfono no escribe fila de zona | T3 |
| R7 | `usuario-zona.test.ts:164` (existente, **sin editar**) | T1 |
| R8 | El resto de la suite verde; `git diff` de `tests/` solo toca lo declarado en T1-T3 | T1-T3 |
| R9 | `usuarios-module`: orden de llamadas (consulta antes de escribir), en las dos puertas | T11 |
| R10 | `usuario-impacto-zona` (3 casos, uno por puerta) + `usuarios-module` (contenido del diálogo) | T7, T11 |
| R11 | `usuarios-module`: cero escrituras con el diálogo abierto | T11 |
| R12 | `usuarios-module`: confirmar → mismos argumentos exactos | T11 |
| R13 | `usuarios-module`: cancelar → cero escrituras | T11 |
| R14 | Test de servicio (`ok` con dinero pendiente) + guardia estática con contraprueba | T12 |
| R15 | `usuario-impacto-zona` (`impacto: null` con otro activo) + `usuarios-module` (sin diálogo) | T7, T11 |
| R16 | `usuario-impacto-zona`: mensajero / sin zona / ya inactivo | T7 |
| R17 | `integration/db`: excluye al propio, a inactivos, a otras zonas y a otros roles | T5 |
| R18 | `integration/db`: comparación cruzada con `findCierresDiaConsolidables` + mutación compartida | T4 |
| R19 | `integration/db` (11 dígitos exactos) + `usuarios-module` (importe formateado) | T4, T11 |
| R20 | `usuarios-module`: consulta con error → diálogo del §4.6 y confirmar aplica | T11 |
| R21 | `usuarios-module`: aserción de **orden** de llamadas | T11 |
| R22 | `usuario-impacto-zona` (`forbidden` sin tocar repos, sin PII en el resultado) + acción | T7, T8 |
| R23 | `usuarios-module`: «Admin satélite» sí, `adminSatelite` no | T11 |

**Ningún requisito sin test.** El reviewer rechaza si falta uno; si alguno resultara no testeable,
está mal escrito y se corrige en `requirements.md`, no se deja pasar.
