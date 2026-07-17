# Feature 82 — Design

Base: `feature/81-api-keys` (`1ebc350`). Todo lo de abajo asume el backend de la 81 tal como esta en el codigo, citado con ruta:linea.

## 1. Modelo de datos

**Sin migraciones. Sin cambios de esquema.** `db/schema.prisma:998-1014` (`model ApiKey`) ya tiene todo lo que el listado necesita: `identificador`, `keyPrefix`, `usuarioId` (`@unique`), `createdAt`, y la relacion `usuario` (`ApiKeyUsuario`).

Sobre indices: el listado ordena por `createdAt desc` con `skip`/`take`. No se agrega indice en v1 — la cardinalidad esperada de `api_key` es de decenas, no de millones; un indice aqui seria ceremonia. Si aparece volumen, el follow-up es `@@index([createdAt])`.

RLS: no aplica cambio. `api_key` la creo la 81 con su politica; esta feature solo lee via Prisma con el mismo cliente de servidor.

**Revocacion: fuera de alcance.** El modelo no tiene columna de estado/revocado; agregarla es migracion + `down.sql` + reglas de negocio (que pasa con el usuario dedicado?). → **feature hermana sugerida: "82a — revocacion de API keys"**.

## 2. Capas nuevas (backend del listado)

Se sigue el patron ya establecido en usuarios (`lib/actions/usuarios.ts:74` → `UsuarioService.listar` → `UserRepository.list`).

### 2.1 `lib/interfaces/repositories/IApiKeyRepository.ts` (extender)

```
export interface ApiKeyListItem {
  id: string;
  identificador: string;
  keyPrefix: string;
  usuarioId: string;
  usuarioEmail: string;   // [D1] via include del usuario
  createdAt: Date;
}
export interface ListApiKeysParams { skip: number; take: number; }
export interface ListApiKeysResult { items: ApiKeyListItem[]; total: number; }

// se agrega a IApiKeyRepository:
list(params: ListApiKeysParams): Promise<ListApiKeysResult>;
count(): Promise<number>;
```

Espejo exacto de `ListUsuariosParams`/`ListUsuariosResult` (`IUserRepository.ts:82-92`).

### 2.2 `lib/repositories/ApiKeyRepository.ts` (extender)

`LIST_SELECT` propio, hermano del `PUBLIC_SELECT` existente (`ApiKeyRepository.ts:22-28`) y con la misma garantia: **`keyHash` no aparece en el `select`, por lo que Prisma ni siquiera lo trae de la DB** (R6).

```
const LIST_SELECT = {
  id: true, identificador: true, keyPrefix: true, usuarioId: true, createdAt: true,
  usuario: { select: { email: true } },
} as const;
```

`list` hace `findMany({ select: LIST_SELECT, orderBy: { createdAt: "desc" }, skip, take })` y aplana `usuario.email` → `usuarioEmail`. `total` via `count()` en el mismo `$transaction` o `Promise.all` (mismo criterio que `UserRepository.list`). Sin logica de negocio, sin permisos (R10).

El tipo de cliente `ApiKeyPrismaClient` (`ApiKeyRepository.ts:13-16`) ya incluye `"apiKey"`: no cambia.

### 2.3 `lib/types/api-key.ts` (extender)

```
export const listarApiKeysSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive()
    .default(apiKeysConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, apiKeysConfig.MAX_PAGE_SIZE)),   // R8
});
export type ListarApiKeysInput = z.infer<typeof listarApiKeysSchema>;
export type ApiKeyListItemDTO = ApiKeyListItem;    // R5: alias, sin keyHash por construccion
export type ListarApiKeysResult =
  | { status: "ok"; items: ApiKeyListItemDTO[]; page: number; pageSize: number; total: number }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }  // R3
  | { status: "forbidden" }        // R2
  | { status: "unauthenticated" }; // R1
```

`ListarApiKeysResult` **no** reusa el `ActionError` de usuarios: aqui no hay `not_found` ni `conflict` posibles, y un union mas estrecho hace que el `toApiKeyActionError` existente (`lib/actions/api-keys.ts:29-38`, que ya explota ante `conflict`/`not_found` inesperados) siga siendo honesto.

### 2.4 `lib/config/api-keys.ts` (nuevo)

Copia literal del molde de `lib/config/usuarios.ts` (defaults 25 / 100, env `API_KEYS_DEFAULT_PAGE_SIZE` / `API_KEYS_MAX_PAGE_SIZE`). [D3]

### 2.5 `lib/interfaces/services/IApiKeyService.ts` (extender)

```
listar(input: ListarApiKeysInput, actor: Actor): Promise<ListarApiKeysResult>;
```

### 2.6 `lib/services/ApiKeyService.ts` (extender)

```
async listar(input, actor) {
  if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };   // R2, reusa el Set existente (linea 14)
  const skip = (input.page - 1) * input.pageSize;
  const { items, total } = await this.repo.list({ skip, take: input.pageSize });
  return { status: "ok", items, page: input.page, pageSize: input.pageSize, total };  // R4/R9
}
```

R9 sale gratis: `skip` mas alla del final → `items: []` con `total` real.

### 2.7 `lib/actions/api-keys.ts` (extender)

```
export async function listarApiKeys(input: unknown, deps: ApiKeyActionDeps = {}): Promise<ListarApiKeysResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();          // R1: antes del service
    const data = listarApiKeysSchema.parse(input ?? {});   // ZodError -> VALIDATION_ERROR (R3)
    const service = deps.apiKeyService ?? buildApiKeyService();
    return service.listar(data, actor);
  });
  return isAppErrorShape(r) ? toApiKeyActionError(r) : r;
}
```

Identico en forma a `listarUsuarios` (`lib/actions/usuarios.ts:74-86`). Reusa `buildApiKeyService`, `ApiKeyActionDeps` y `toApiKeyActionError` ya existentes. Server Action, **no** route handler: es lectura interna desde componente propio (`docs/architecture.md`, tabla Server Actions vs Route Handlers).

**Autorizacion, dos capas, ninguna en la UI:** la pagina resuelve el actor server-side (R11) *y* la action lo vuelve a resolver + el service filtra por rol (R1/R2). Ocultar el boton no es una defensa.

## 3. Contratos I/O

| Operacion | Entrada | Salida ok | Errores |
| --- | --- | --- | --- |
| `listarApiKeys` | `{ page?: number; pageSize?: number }` | `{ status:"ok", items: ApiKeyListItemDTO[], page, pageSize, total }` | `validation_error` \| `forbidden` \| `unauthenticated` |
| `generarApiKey` (**existente, no se toca**) | `{ identificador: string }` | `{ status:"ok", apiKey: ApiKeyPublico, plainKey: string }` | `validation_error` \| `conflict` \| `forbidden` \| `unauthenticated` |

**Invariante R6:** ningun tipo del union de salida contiene `keyHash`. No es disciplina: `LIST_SELECT` no lo pide a Postgres y `ApiKeyListItem` no lo declara, asi que filtrarlo requeriria escribir codigo nuevo a proposito.

## 4. Frontend

### 4.1 `app/(app)/configuracion/api/page.tsx` (rellenar)

Se conserva el guard existente (lineas 11-21) y se alinea el layout a `PageHeader` + `Container` [D7]. Tras el guard:

```
const res = await listarApiKeys({ page: 1, pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE });   // R12
const data = res.status === "ok"
  ? { items: res.items, total: res.total, pageSize: res.pageSize }
  : { items: [], total: 0, pageSize: apiKeysConfig.DEFAULT_PAGE_SIZE };                    // R13
return (... <ApiKeysModule initialData={data} /> ...);
```

Calcado de `app/(app)/configuracion/page.tsx:35-47`.

### 4.2 `app/(app)/configuracion/api/_components/ApiKeysModule.tsx` (nuevo, cliente)

Molde: `UsuariosModule.tsx`. Reusa `DataTable` (feat 7), `Pagination` (feat 8), `Modal` (feat 13), `useToast` (feat 11) y el manejador global de errores (feat 10) via las actions. SWR con `fallbackData` cuando `page === 1 && pageSize === initialData.pageSize` (R12/R18/R19).

Estado: `page`, `pageSize`, `formOpen`, `revelado: { plainKey: string; identificador: string } | null`, `enviando: boolean` (R31).

### 4.3 `.../_components/api-keys-columns.tsx` (nuevo)

Molde: `usuarios-columns.tsx`. Columnas (R14): `identificador` · `keyPrefix` renderizado como `` `${row.keyPrefix}…` `` en `font-mono` (R15) · `usuarioEmail` [D1] · `createdAt` formateado. **Sin columna de acciones**: no hay ninguna operacion por fila en este alcance.

### 4.4 `.../_components/GenerarApiKeyForm.tsx` (nuevo)

Molde: `UsuarioForm` con `ref`/`FormHandle` (ver `UsuariosModule.tsx:64,90`). Un solo campo `identificador`; los `fieldErrors` del backend se pintan bajo el campo (R21).

### 4.5 El punto de diseno central: el secreto que solo existe una vez

**Dos modales secuenciales, no uno.** El de creacion se cierra al recibir `ok`; el de revelado se abre con el `plainKey`. Separarlos evita que un formulario y un secreto compartan el mismo ciclo de vida y que un re-submit accidental conviva con la clave en pantalla.

Modal de revelado (`RevelarApiKeyModal`), contrato [D5]:

- `plainKey` en `font-mono`, seleccionable, con `aria-label`.
- Aviso `role="alert"`: **"Esta es la unica vez que veras esta clave. Si la pierdes, tendras que generar otra."** (R24)
- Boton **Copiar** → `navigator.clipboard.writeText`; exito y fallo ambos con toast (R25/R26). Si la API no existe o rechaza, toast de error y el texto sigue ahi para copiar a mano [D6]. Copiar **no** cierra nada.
- Checkbox **"Ya guarde la clave en un lugar seguro"**; mientras este sin marcar, el boton **Cerrar** esta `disabled` (R27).
- `Modal` con `onOpenChange` interceptado: mientras `revelado !== null` y el checkbox no este marcado, ignora Escape y click-fuera. **Un cierre accidental es indistinguible de perder la clave; por eso no se permite que sea accidental.**
- Al cerrar: `setRevelado(null)` → el `plainKey` deja de existir en el estado del cliente. No hay accion que lo recupere (el backend no puede: `ApiKeyRepository` solo guarda el SHA-256, `schema.prisma:1003`) (R28).
- El `mutate()` de SWR se dispara **al recibir `ok`**, no al cerrar: la fila con su prefijo ya esta en la tabla cuando el usuario cierra el modal (R29).
- R30: el `plainKey` vive en `useState` y nada mas. Sin `console.log`, sin querystring, sin `localStorage`.

## 5. Alternativas descartadas

### 5.1 (Principal) Reusar `generarApiKey` como fuente del listado guardando las keys generadas en el cliente

**Descartada.** Evitaria todo el backend nuevo, pero: (a) el listado moriria con el refresh, (b) no veria keys generadas por otra sesion o antes de la feature, y (c) para ser util tendria que persistir los secretos en el navegador — exactamente lo que R30 y todo el diseno de la 81 (hash SHA-256, `PUBLIC_SELECT` sin `keyHash`) existen para impedir. Convertiria una feature de lectura en una fuga de secretos.

### 5.2 Route handler `GET /api/api-keys` + fetch desde el cliente

**Descartada.** `docs/architecture.md` reserva los route handlers para webhooks, API publica y crons; este es un consumidor propio dentro del mismo proyecto. Ademas obligaria a re-implementar auth por cookie en el borde HTTP, cuando `resolveActorFromSession` en la Server Action ya lo resuelve y es el patron de las 6 actions de `usuarios.ts`.

### 5.3 Devolver `ApiKeyPublico` en el listado (sin `usuarioEmail`) y resolver el usuario en un segundo fetch

**Descartada.** `ApiKeyPublico` solo trae `usuarioId` (`lib/types/api-key.ts:20-27`), un uuid ilegible; resolverlo por fila seria N+1 y exigiria exponer una lectura de usuarios por id desde esta pantalla. Un `include` del email en el mismo `select` es una query y cero superficie nueva. [D1]

### 5.4 Cerrar el modal del secreto solo si el usuario pulso "Copiar"

**Descartada.** Ver [D5]: copiar no prueba haber guardado, y ata el cierre a `navigator.clipboard`, que no existe en contextos no seguros — dejaria al usuario encerrado en un modal que no puede cerrar. El checkbox es una afirmacion del usuario, no una inferencia de la maquina.

### 5.5 Auto-cerrar el revelado tras un temporizador

**Descartada.** Un timer que borra la unica copia de un secreto mientras el usuario lo pega en otro sitio es un fallo silencioso disfrazado de seguridad. La clave ya no persiste en ningun lado: no gana nada frente al riesgo de perderla.

## 6. Riesgo de integracion

Esta rama esta apilada sobre `feature/81-api-keys` (PR #86 abierto, **no** en `dev`). Si la 81 cambia sus contratos durante la revision (`GenerarApiKeyResult`, `ApiKeyPublico`, `IApiKeyRepository`), esta feature se rompe en compilacion — que es el comportamiento deseado. **La 82 no se mergea a `dev` antes que la 81.**
