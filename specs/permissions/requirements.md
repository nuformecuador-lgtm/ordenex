# Requisitos — permissions

> Alcance: modelo de datos de la tabla de permisos y su relación con la tabla
> `rol` existente. NO incluye endpoints, UI, enforcement de permisos en runtime,
> ni seed/lista de permisos (la tabla queda vacía). El seed de roles pertenece a
> la feature #4 y queda fuera de este alcance.

## Modelo de datos — tabla de permisos

- **R1 (ubicuo):** El sistema DEBE persistir cada permiso con los campos: `id`,
  `nombre`, `method`, `route`, `created_at` y `updated_at`.
- **R2 (ubicuo):** El sistema DEBE generar el `id` de cada permiso como
  identificador único generado automáticamente (UUID), consistente con el resto
  de modelos del esquema.
- **R3 (ubicuo):** El sistema DEBE almacenar `nombre`, `method` y `route` como
  texto no nulo.
- **R4 (por evento):** CUANDO se crea un permiso sin especificar `created_at`, el
  sistema DEBE asignar automáticamente la marca de tiempo del instante de
  creación.
- **R5 (por evento):** CUANDO se actualiza un permiso, el sistema DEBE actualizar
  automáticamente `updated_at` a la marca de tiempo del instante de la
  modificación.
- **R6 (ubicuo):** El sistema DEBE garantizar que no existan dos permisos con la
  misma combinación (`method`, `route`).

## Relación con roles

- **R7 (ubicuo):** El sistema DEBE permitir asociar un permiso a cero, uno o
  varios roles, y un rol a cero, uno o varios permisos (relación muchos-a-muchos
  entre `rol` y `permiso`).
- **R8 (ubicuo):** El sistema DEBE garantizar que cada asociación entre un rol y
  un permiso sea única (no se permite la misma pareja rol↔permiso duplicada).
- **R9 (condicional):** SI se intenta crear una asociación cuyo `rol` o `permiso`
  referenciado no existe, ENTONCES el sistema DEBE rechazar la operación por
  violación de clave foránea.

## Estado inicial de datos

- **R10 (ubicuo):** El sistema DEBE dejar la tabla de permisos vacía tras aplicar
  la migración: no se insertan permisos iniciales ni datos semilla en esta
  feature.
- **R11 (ubicuo):** El sistema DEBE dejar la tabla pivote rol↔permiso vacía tras
  aplicar la migración: no se crean asociaciones iniciales.

## Seguridad (RLS)

- **R12 (ubicuo):** El sistema DEBE habilitar Row Level Security en la tabla de
  permisos y en la tabla pivote rol↔permiso, sin políticas para los roles `anon`
  ni `authenticated`, de forma coherente con las demás tablas del esquema
  (acceso solo desde el servidor con service role).
- **R13 (condicional):** SI un cliente con la key `anon` o `authenticated`
  consulta la tabla de permisos o la tabla pivote rol↔permiso, ENTONCES el
  sistema DEBE rechazar/devolver vacío por RLS sin exponer filas.

## Reversibilidad de la migración

- **R14 (ubicuo):** El sistema DEBE proveer un `down.sql` que revierta
  exactamente la migración de esta feature (elimina la tabla de permisos y la
  tabla pivote) sin afectar tablas preexistentes (`rol`, `usuario`, etc.).

## Criterios de aceptación (verificables)

- `prisma validate` pasa sin errores con el nuevo modelo.
- Crear un permiso sin `created_at`/`updated_at` deja ambos timestamps poblados
  (R4, R5).
- Insertar dos permisos con el mismo (`method`, `route`) falla por unicidad (R6).
- Insertar dos veces la misma pareja rol↔permiso falla por unicidad (R8).
- Insertar una asociación con `rol_id` o `permiso_id` inexistente falla por FK
  (R9).
- Tras migrar, `SELECT count(*)` de la tabla de permisos y de la pivote = 0
  (R10, R11).
- Consulta con key `anon` a ambas tablas no devuelve filas (R13).
- `db:rollback` seguido de `db:migrate` deja el esquema idéntico (R14).

## Preguntas abiertas

1. **Nombre de columna `method`:** ¿se restringe a un conjunto cerrado de verbos
   HTTP (enum `GET`/`POST`/`PUT`/`PATCH`/`DELETE`) o se deja como texto libre?
   Supuesto adoptado (marcable): texto libre (`String`) para no acoplar el
   catálogo a un enum en Postgres; se documenta como decisión revisable en
   `design.md`. Confirmar antes de implementar si se prefiere enum.
2. **Unicidad de `nombre`:** el enunciado no lo exige; se asume unicidad solo por
   (`method`, `route`) (R6) y `nombre` no único. Confirmar si `nombre` también
   debe ser único.
