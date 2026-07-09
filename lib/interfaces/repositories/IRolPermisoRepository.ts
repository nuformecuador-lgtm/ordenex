export interface AsociarInput {
  rolId: string;
  permisoId: string;
}

export interface RolPermiso {
  rolId: string;
  permisoId: string;
  createdAt: Date;
}

export interface IRolPermisoRepository {
  asociar(input: AsociarInput): Promise<RolPermiso>;
  listarPorRol(rolId: string): Promise<RolPermiso[]>;
  listarPorPermiso(permisoId: string): Promise<RolPermiso[]>;
  contar(): Promise<number>;
}
