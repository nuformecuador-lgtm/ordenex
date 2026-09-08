# Ficha 379 — Design

**Rama:** `fix/379-zona-usuario-cierres-huerfanos`. **Zona:** fullstack (backend → frontend,
secuenciado). **Migración: NO** (§6).

---

## §1 — El diseño está partido en dos, y la partición es del encargo

| | Qué es | Superficie | ¿Aterriza sola? |
| --- | --- | --- | --- |
| **BLOQUE A** (R1-R8) | La zona sigue al rol en `actualizar`, igual que ya la sigue el vehículo | backend puro | **Sí** |
| **BLOQUE B** (R9-R23) | Aviso con números antes de dejar una zona sin administrador de bodega | backend + pantalla | Necesita A mergeado, no lo contrario |

**A puede salir sin B.** Si B se complica, A ya cierra D2 y no le quita nada a nadie. B **no**
depende de A para funcionar, pero sí para no contradecirla: sin A, el cambio de rol deja la zona
pegada y el aviso hablaría de una zona que el usuario formalmente no ha abandonado.

---

## §2 — Bloque A: tres líneas en `UsuarioService.actualizar`

### 2.1 El estado de hoy, citado

`lib/services/UsuarioService.ts`, dentro de `actualizar` (`:243-296`):

```ts
// :259 — LA ZONA: solo mira si viene el campo
if (input.zonaId !== undefined) {
  const rolIdResultante = input.rolId ?? actual.rolId;
  const zona = await this.resolverZona(rolIdResultante, input.zonaId);
  ...
}

// :271 — EL VEHÍCULO: mira el campo O el rol, y toma el valor actual como deseado
if (input.vehiculoId !== undefined || input.rolId !== undefined) {
  const rolIdResultante = input.rolId ?? actual.rolId;
  const deseado = input.vehiculoId !== undefined ? input.vehiculoId : actual.vehiculoId;
  ...
}
```

### 2.2 El cambio

La zona adopta **la forma exacta del vehículo**. No se inventa una regla: se copia la que el mismo
método ya aplica al campo hermano, y que `crear` (`:98-101`) ya aplica a la zona.

```ts
if (input.zonaId !== undefined || input.rolId !== undefined) {
  const rolIdResultante = input.rolId ?? actual.rolId;
  const deseado = input.zonaId !== undefined ? input.zonaId : actual.zonaId;
  const zona = await this.resolverZona(rolIdResultante, deseado);
  if (!zona.ok) {
    return { status: "validation_error", fieldErrors: { zonaId: [zonaErrorMessage(zona.reason)] } };
  }
  data.zonaId = zona.zonaId;
}
```

**`resolverZona` no se toca.** Su primera línea (`:460`) ya dice `if (!esRolConZona) return { ok:
true, zonaId: null }`. Todo el defecto era no llamarla.

### 2.3 Los cuatro caminos, enumerados (esto es lo que se testea)

| Rol resultante | ¿Viene `zonaId`? | Zona actual | Resultado |
| --- | --- | --- | --- |
| No lleva zona (admin, adminTienda, maestro…) | no | Z | **`null`** ← R1, el arreglo |
| No lleva zona | sí (cualquiera) | cualquiera | `null` (ya hoy, `resolverZona` ignora el valor) |
| Lleva zona (mensajero/adminSatelite) | no | Z | **Z**, revalidada contra el catálogo ← R2 |
| Lleva zona | no | `null` | **`validation_error{zonaId}`** ← R3 / AS4 |

### 2.4 Dos consecuencias que hay que mirar de frente

**(a) El rastro NO se pierde: se crea.** `UserRepository.update` (`lib/repositories/UserRepository.ts:457-465`):

```ts
if (data.zonaId !== undefined && data.zonaId !== previo.zonaId) {
  entradas.push({ accion: "usuario_zona_cambiada", ..., valorAnterior: previo.zona?.nombre ?? null, valorNuevo: despues?.zona?.nombre ?? null });
}
```

Hoy, al cambiar el rol sin enviar zona, `data.zonaId` es `undefined` → **no se escribe nada** y la
zona vieja se queda pegada a la fila sin que conste que nadie decidió eso. Con el arreglo,
`data.zonaId = null` difiere del previo → se escribe `usuario_zona_cambiada` con el **nombre de la
zona anterior**, y en el **mismo lote** (`lote_id`) que `usuario_rol_cambiado`, así que se lee como
un acto de dos efectos y no como dos actos sueltos. *La respuesta a la pregunta «¿borramos la única
pista?» es que hoy **no hay ninguna pista** y el arreglo la fabrica.* (Ver `requirements.md` Q3.)

**Sin ruido:** si la zona ya era `null`, `null !== null` es falso → cero entradas. Editar el teléfono
sigue sin escribir nada.

**(b) Un `toEqual` literal existente se pone rojo, y es correcto que se ponga.**
`tests/unit/services/usuario-service.test.ts:163-175` afirma:

```ts
const r = await service.actualizar("usr-1", { nombre: "Nuevo", rolId: "rol-2" }, MAESTRO);
expect(data).toEqual({ nombre: "Nuevo", rolId: "rol-2", fulfillment: false, vehiculoId: null });
```

Con el arreglo, `data` incluye además `zonaId: null`. **Ese literal ES el contrato** («qué campos
escribe una edición»), y esta ficha lo cambia a propósito: se actualiza a
`{ ..., vehiculoId: null, zonaId: null }` y pasa a ser el test de R1. **Prohibido** relajarlo a
`toMatchObject` o a una comparación derivada del propio `data`: eso lo dejaría verde para siempre.

---

## §3 — Bloque B: el predicado, escrito una vez

> **Aviso** ⇔ el usuario **es hoy** `adminSatelite` con `estado = activo` y `zona_id = Z` (no nula),
> **y** el cambio pedido hace que deje de cumplirse esa condición para Z, **y** en Z no queda
> **ningún otro** usuario `adminSatelite` con `estado = activo`.

«Deja de cumplirse» abarca las tres puertas con un solo predicado:

| Puerta | Cambio pedido | ¿Deja de ser adminSatelite activo de Z? |
| --- | --- | --- |
| **D1** | `zonaId` pasa a Y (o a `null`) | sí |
| **D2** | `rolId` pasa a un rol distinto de `adminSatelite` | sí (y con el Bloque A, además pierde la zona) |
| **D3** | `estado` pasa a `inactivo` | sí |

Casos que **no** avisan, por construcción y no por una lista: rol o zona que no cambian; `estado`
que pasa a `activo`; usuario `mensajero` (R16); usuario sin zona; y una zona en la que quede al
menos otro administrador de bodega activo (R15/AS2).

---

## §4 — Contratos

### 4.1 Repositorio de cierres — **una sola definición del dinero atrapado**

`lib/interfaces/repositories/ICierreBodegaRepository.ts`:

```ts
/** Ficha 379/R18 — el MISMO conjunto que `findCierresDiaConsolidables`, agregado.
 *  Cuenta e importe salen de `consolidablesWhere(zonaId)`: la función que ya decide
 *  qué puede consolidar esa bodega. Si alguien cambia ese criterio, el aviso cambia
 *  con él — que es exactamente lo que no puede fallar aquí. Money-safe: STRING
 *  escala 2, nunca `number`. */
resumirConsolidablesPendientes(zonaId: string): Promise<ResumenConsolidablesPendientes>;

export interface ResumenConsolidablesPendientes {
  cantidad: number;        // # de cierre_dia consolidables
  totalGeneral: string;    // Decimal(12,2) serializado; "0.00" cuando no hay ninguno
}
```

Implementación en `lib/repositories/CierreBodegaRepository.ts`: `prisma.cierreDia.aggregate({ where:
consolidablesWhere(zonaId), _count: { _all: true }, _sum: { totalGeneral: true } })`, sin `filtros`
(el aviso mira **toda** la cola, no un rango). `_sum` devuelve `null` con cero filas → `"0.00"`.
El índice `@@index([cierreBodegaId])` y `@@index([destinoTipo, destinoZonaId])` ya existen: no hay
consulta sin índice.

**Por qué reutilizar `consolidablesWhere` y no escribir el `where` otra vez:** es el mismo argumento
que el propio archivo ya usa para `ORDEN_CONSOLIDABLES` y `cierresBodegaDeZonaWhere` (`:164-182`),
y porque un aviso que dice un número distinto del que la pantalla de consolidación enseña es peor
que no avisar.

### 4.2 Repositorio de usuarios — el recuento

`lib/interfaces/repositories/IUserRepository.ts`:

```ts
/** Ficha 379/R17 — cuántos usuarios `adminSatelite` con `estado='activo'` hay en `zonaId`,
 *  EXCLUYENDO a `excluirUsuarioId` (el usuario cuyo cambio se está evaluando: contarlo sería
 *  contar a quien está a punto de irse). Devuelve un número; nunca filas, nunca PII (R22). */
contarAdminSatelitesActivos(zonaId: string, excluirUsuarioId: string): Promise<number>;
```

Implementación: `prisma.usuario.count({ where: { zonaId, estado: "activo", id: { not:
excluirUsuarioId }, rol: { value: "adminSatelite" } } })`. El corte va **en el `WHERE`**, no en
memoria.

### 4.3 Servicio — método nuevo en `UsuarioService`

**Por qué ahí y no en un servicio nuevo:** el módulo de usuarios tiene **una** lista de permisos
(`ALLOWED_ROLES = new Set(["maestro"])`, `UsuarioService.ts:38`) y el propio archivo ya dejó escrito
el motivo al añadir `restablecerContrasena` (`:357-359`): *«el MISMO `ALLOWED_ROLES` del resto del
módulo, no una copia. Dos listas de permisos para el mismo módulo divergen en cuanto alguien toque
una.»* Un servicio aparte tendría que declarar la suya.

`lib/interfaces/services/IUsuarioService.ts`:

```ts
/** Ficha 379 — el cambio que se está evaluando. Los tres campos son opcionales y
 *  representan la INTENCIÓN, no el estado: lo que no viene, no cambia. */
export interface CambioUsuarioEvaluable {
  rolId?: string;
  zonaId?: string | null;
  estado?: "activo" | "inactivo";
}

/** Ficha 379/R10 — lo que el aviso necesita decir, y nada más. Sin PII (R22). */
export interface ImpactoSalidaAdminSatelite {
  zonaNombre: string;
  cierresSinConsolidar: number;
  totalSinConsolidar: string;              // STRING escala 2 (R19)
  adminSatelitesActivosRestantes: number;  // siempre 0 cuando el impacto existe
}

export type ConsultarImpactoCambioServiceResult =
  | { status: "ok"; impacto: ImpactoSalidaAdminSatelite | null } // null = nada que avisar
  | { status: "forbidden" }
  | { status: "not_found" };
```

Método `consultarImpactoCambio(id, cambio, actor)`, en este orden y sin atajos:

1. `ALLOWED_ROLES` (R22) → `forbidden`.
2. `repo.findById(id)`; si no existe → `not_found`.
3. Si `actual.zonaId == null` → `{ ok, impacto: null }`.
4. `repo.listRoles()` → si el rol actual no es `adminSatelite`, o `actual.estado !== "activo"` →
   `impacto: null` (R16).
5. Calcular el rol/zona/estado **resultantes** con la misma regla del Bloque A
   (`resolverZona(rolResultante, deseado)`), y si sigue siendo `adminSatelite` activo de la misma
   zona → `impacto: null`.
6. `contarAdminSatelitesActivos(actual.zonaId, id)`; si `> 0` → `impacto: null` (R15/AS2).
7. `zonaRepo.findById(actual.zonaId, false)` → nombre; `cierresRepo.resumirConsolidablesPendientes(
   actual.zonaId)` → cuenta e importe. Devolver el impacto.

**El paso 5 comparte código con el Bloque A**, no lo copia: la pregunta «¿este cambio deja al usuario
sin ser adminSatelite de Z?» y la pregunta «¿qué zona le queda tras este cambio?» son la misma
función. Se extrae un helper privado y las dos lo usan; dos copias de esa regla se separan a la
primera (es literalmente el defecto que esta ficha arregla, con la zona y el vehículo).

**Inyección:** `ICierreBodegaRepository` entra como **sexto parámetro del constructor**, opcional por
la misma razón que `sessionRepo` (hay decenas de `new UsuarioService(repo)` en tests) y con la misma
disciplina: **`consultarImpactoCambio` LANZA si no está**, con mensaje explícito. Un colaborador
opcional que se ignora en silencio ya dejó dos notificadores muertos en este repo con la suite
entera en verde; y aquí «no puedo leer el dinero» devuelto como «no hay dinero» es exactamente el
fallo mudo que la ficha combate. Que se **pasa de verdad** lo prueba
`tests/unit/actions/usuarios-composition.test.ts` (T10).

### 4.4 Borde — Server Action, no route handler

Mutación/consulta interna desde un componente propio ⇒ Server Action (`docs/architecture.md`, tabla
«Server Actions vs Route Handlers»). En `lib/actions/usuarios.ts`, calcada de las otras ocho:
`withErrorHandler` + `resolveActorFromSession` + `idSchema` + `toUsuarioActionError`.

```ts
export async function consultarImpactoCambioUsuario(
  id: unknown,
  cambio: unknown,
  deps: UsuarioActionDeps = {},
): Promise<ConsultarImpactoCambioUsuarioResult>
```

Schema en `lib/types/usuario.ts`, **derivado** del que ya existe (mismo patrón que
`listarUsuariosCompletoSchema`, que se deriva del listado para no admitir lo que el otro rechaza):

```ts
export const consultarImpactoCambioUsuarioSchema = actualizarUsuarioSchema
  .pick({ rolId: true, zonaId: true })
  .extend({ estado: cambiarEstadoUsuarioSchema.shape.estado.optional() })
  .strict();

export type ConsultarImpactoCambioUsuarioResult =
  | { status: "ok"; impacto: ImpactoSalidaAdminSatelite | null }
  | ActionError;
```

`actualizarUsuarioSchema` **no se toca**: no se le añade ningún campo. Su `.strict()` y el test
`tests/unit/types/usuario-schema.test.ts` siguen valiendo palabra por palabra.

### 4.5 Pantalla — `app/(app)/configuracion/_components/`

Dos ficheros, y ninguno nuevo salvo el diálogo si se decide extraerlo.

**`UsuarioForm.tsx`** — el handle gana **un** método:

```ts
export interface UsuarioFormHandle {
  submit: () => Promise<UsuarioFormResult>;
  /** Ficha 379 — valida (pintando los errores como siempre) y devuelve el cambio PENDIENTE de
   *  rol/zona en modo edición. `null` = no hay nada que evaluar (modo crear, o la validación
   *  de cliente falló y el maestro ya está viendo el error de campo). */
  cambioPendiente: () => CambioUsuarioEvaluable | null;
}
```

Se apoya en el `validate()` que ya existe (`:195-273`); **no duplica reglas**. Devuelve
`{ rolId, zonaId }` con el mismo criterio de `esRolConZona` que ya se aplica al construir el payload
(`:235`), así que lo que se evalúa es exactamente lo que se va a enviar.

**`UsuariosModule.tsx`** — un estado, un modal y dos puntos de llamada:

```
onConfirmForm()            → si formMode==="editar": cambioPendiente() → consultar → ¿impacto? sí: abrir aviso; no: guardar
cambiarEstado(row)         → consultar({ estado: destino })            → ¿impacto? sí: abrir aviso; no: aplicar
confirmarAviso()           → ejecuta la acción diferida (R12)
descartarAviso()           → tira la acción diferida (R13)
```

El diálogo es el **mismo `Modal` compartido** que ya usa este módulo para la confirmación de
restablecer contraseña (`:448-465`), con el texto en `description` — que es donde el `Modal` lo
cuelga de `aria-describedby`, así que quien usa lector de pantalla lo **oye** al abrirse. No se crea
ninguna primitiva: `docs/architecture.md` prohíbe inventar componente si ya existe.

**Cuando no hay impacto no aparece nada** (R15): mismos clics que hoy, incluida la inactivación de un
mensajero, que es el 100 % de lo que los tests actuales de este módulo ejercitan
(`tests/unit/components/usuarios-module.test.tsx:66`, fixture `rolValue: "mensajero"`).

### 4.6 El texto, decidido aquí y no en el código

Etiqueta del rol: **de `ROL_LABELS` (`lib/auth/rol-label.ts:13`, «Admin satélite»)**, nunca el
literal `adminSatelite` (R23). Importe: **`formatMontoString`** de `lib/config/moneda.ts:282`, que
formatea desde `string` sin pasar por `Number` (R19). Nada de siglas ni de jerga interna.

- **Título:** `La zona <Zona> se queda sin Admin satélite`
- **Cuerpo (con cierres pendientes):**
  `Es el único Admin satélite activo de la zona <Zona>. Si continúas, esa zona se queda sin nadie
  que pueda consolidar sus cierres: ni el maestro ni un admin pueden hacerlo desde otra zona.
  Ahora mismo hay <N> cierres aprobados sin consolidar, por <₡X>.`
- **Cuerpo (sin cierres pendientes, AS1):** misma primera parte, y después
  `Ahora mismo no hay cierres pendientes, pero los que entren después quedarán retenidos hasta que
  la zona vuelva a tener un Admin satélite.`
- **Cuerpo (R20, la consulta falló):**
  `No se pudo comprobar si la zona <Zona> se queda sin Admin satélite ni cuánto dinero tiene sin
  consolidar. Puedes continuar de todas formas.`
- **Botones:** `Continuar` / `Cancelar`. El de confirmar **no** es `destructive`: no se está
  destruyendo nada, se está avisando.

Singular/plural («1 cierre aprobado» / «N cierres aprobados») se resuelve como ya lo resuelve
`mensajeSesionesRevocadas` en este mismo archivo (`:496-504`): función pura, testeable sola.

---

## §5 — Composition root

`buildUsuarioService()` (`lib/actions/usuarios.ts:52-66`) pasa a construir también
`new CierreBodegaRepository(prisma)`. **Que se pase de verdad se prueba**, no se supone: el archivo
ya trae el precedente escrito («NO basta con importarlo: el parámetro es opcional, así que olvidarlo
NO rompe el typecheck y el servicio saldría a producción lanzando en cuanto alguien pulsara el
botón»). T10 extiende `usuarios-composition.test.ts` con esa aserción.

---

## §6 — Modelo de datos, migraciones y RLS

**No hay migración, y estas son las cuatro razones, una por cada cosa que podría haberla pedido:**

| Podría pedirla | Por qué no |
| --- | --- |
| Tabla nueva | No hay. Todo lo que el aviso dice se **deriva** de `cierre_dia` y `usuario`. |
| Columna nueva | No hay. El aviso no persiste nada: es una lectura previa, no un registro. |
| Valor de enum nuevo | El rastro del Bloque A usa `usuario_zona_cambiada`, que **ya existe** en `historial_accion_tipo` desde `20260902120000_historial_accion`. Un aviso por *notificación* sí habría exigido ampliar `NotificacionEvento` — por eso ese camino está descartado (§7, A3). |
| Backfill | D2 ya ocurrió en **0 filas** (medido en producción el 2026-09-08). No hay nada que reparar. |

**RLS:** no se crea ninguna tabla, así que no hay política nueva. Las dos lecturas nuevas van por
Prisma con el `WHERE` acotado en servidor y bajo el guard de rol del servicio (R22).

**Índices:** ninguno nuevo. `cierre_dia` ya tiene `@@index([destinoTipo, destinoZonaId])` y
`@@index([cierreBodegaId])`; el `count` de usuarios recorre una tabla de decenas de filas.

---

## §7 — Alternativas descartadas

**A1 — La guarda dura: impedir el cambio mientras haya dinero atrapado.** Era la única salida que el
implementador había encontrado con cero líneas de frontend (`actualizar` ya devuelve
`validation_error{fieldErrors}`, el formulario ya hace `setErrors` y ya pinta `zonaId`).
**Descartada por el humano el 2026-09-08: «no, no quiero daños».** Bloqueaba al maestro —el único rol
que administra usuarios— justo cuando más necesita moverse. **No se repropone.**

**A2 — Abrir la consolidación a maestro/admin.** Medido y descartado antes de esta ficha: no es una
guarda, es cambiar de quién es el dinero. `repartirEfectivo` (`CierreBodegaService.ts:96-127`) paga a
los mensajeros **con el efectivo que hay físicamente en la bodega**; consolidar desde un escritorio
produce un pago registrado sin efectivo detrás.

**A3 — Avisar por notificación en vez de en pantalla.** Exige **migración de enum**:
`NotificacionEvento` es inventario cerrado y el schema lo dice literalmente. Y aunque la migración
fuera gratis, el destinatario natural del aviso es **el maestro que está en ese momento delante de la
pantalla decidiendo**: una notificación llega después de que ya lo hizo. Se resuelve en la propia
pantalla, que era la opción preferida del encargo.

**A4 — Que `actualizar`/`cambiarEstado` devuelvan `requiere_confirmacion` salvo `confirmado: true`.**
Es la variante «interstitial en el servicio», y es tentadora porque el aviso sería imposible de
saltar. Se descarta por dos motivos: (a) obliga a meter un campo que **no es un campo editable** en
`actualizarUsuarioSchema`, que es `.strict()` y cuyo contrato («solo campos editables, nunca
email/cédula/password») está protegido por su propio test; (b) convierte la **primera llamada de
cualquier consumidor** en un no-op silencioso — un cambio que parece hecho y no lo está, que es
justo la familia de fallo que esta ficha combate. La consulta previa vive en una acción **de solo
lectura**: no puede romper nada aunque falle.

**A5 — Aviso inline en el formulario (un texto bajo el selector de zona) en vez de diálogo.** Más
barato, pero (a) **no cubre D3**, que se dispara desde el botón de la fila y no tiene formulario
donde poner el texto, y (b) un párrafo que aparece bajo un campo se lee menos que un diálogo que hay
que confirmar. El precedente de esta misma pantalla —la confirmación de restablecer contraseña— usa
diálogo por lo mismo.

**A6 — Un servicio nuevo dedicado (`ImpactoUsuarioZonaService`).** Más limpio en el papel (saca la
dependencia del dinero fuera del CRUD de usuarios), pero obliga a declarar **una segunda lista de
permisos** para el mismo módulo, y el propio `UsuarioService` ya dejó escrito por qué eso se paga
caro. Se prefiere el precedente de la casa.

**A7 — Que la pantalla decida a quién preguntar** (llamar a la consulta solo si la fila es
`adminSatelite` activo). Ahorra una lectura por edición, a cambio de meter literales de rol en un
componente y de que un olvido produzca un cambio silencioso. Ver AS5, con su vuelta atrás.

---

## §8 — Riesgos declarados

**RS1 — El número es una foto, no un candado.** Entre que el aviso se pinta y el maestro confirma
puede entrar o consolidarse un cierre. **No importa**: es un aviso, no una guarda (R14). Un candado
aquí sería A1, que está derogada. Se escribe para que nadie lo «arregle» más adelante añadiendo una
revalidación que bloquee.

**RS2 — Nadie ha visto este diálogo en una pantalla real.** Los tests de componente corren en jsdom.
Antes de dar la ficha por cerrada hay que abrirlo en la app (T13), que en este repo ya encontró siete
textos rotos que 12.000 tests daban por buenos.

**RS3 — La cola de consolidables no lleva cota.** El agregado es un `count`+`sum` en Postgres (no
materializa filas), así que aquí el riesgo es menor que en la pantalla de consolidación, que ya
declara su propia excepción. Se anota por simetría.

**RS4 — R3/AS4 introduce un rechazo nuevo inalcanzable desde la pantalla.** Si aparece un consumidor
directo de la acción (Q5), lo verá. Vuelta atrás en AS4.

---

## §9 — Verificación

**El gate rápido se va a negar, y con razón.** `init.sh:134-135`: el diff toca `lib/types/usuario.ts`
(`^lib/types/` está en `RUTAS_SENSIBLES`) y `lib/interfaces/repositories/ICierreBodegaRepository.ts`
+ `lib/repositories/CierreBodegaRepository.ts` (`cierre` está en `NOMBRES_DE_DINERO`). **`./init.sh`
completo, y es un `fail`, no un aviso.** Presupuestar 5-11 min desde el principio.

**Dónde se prueba cada cosa:**

- El `WHERE` del dinero **se prueba donde vive**: `tests/integration/db` contra Postgres real. Los
  tests de servicio usan dobles y no ven el SQL — medido cuatro veces en este repo: una mutación del
  `WHERE` los pasa en verde.
- Todo test de integración con datos tiene que **fallar sin ellos**, con un error ruidoso. Un
  `if (!fks) return;` reporta `passed` sin comprobar nada.
- Cada requisito trae **su mutación** en `tasks.md`: si al invertir la línea el test no se pone rojo,
  el test no vale.

---

## §10 — Orden de aterrizaje

```
A: T1 → T2 → T3            (backend puro; mergeable solo)
B: T4 ─┬─ T5 ─┬─ T6 → T7 → T8 → T9 → T10 → T11 → T12
       └──────┘            (T4 y T5 en paralelo)
Cierre: T13 (mirar la app) → T14 (gate completo)
```
