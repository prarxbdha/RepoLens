import type { ReadStream } from "node:fs";
import { join as pathJoin, type PathLike } from "node:path";
export { add as sum } from "./math";
export * from "./types";

export interface Repository<T> {
  readonly name: string;
  get(id: number): Promise<T | undefined>;
}

export type Identifier = string | number;

export enum Status {
  Active = "active",
  Inactive = "inactive",
}

/** Generic service with overloads. */
export class Service<T extends Repository<Identifier>> {
  private readonly stream: ReadStream | null = null;

  constructor(private readonly repo: T) {}

  find(id: number): T;
  find(id: string): Promise<T>;
  find(id: Identifier): T | Promise<T> {
    return this.repo.get(Number(id)) as T | Promise<T>;
  }

  static async create<U extends Repository<Identifier>>(repo: U): Promise<Service<U>> {
    return new Service(repo);
  }
}

export default function bootstrap(path: PathLike): string {
  return pathJoin(String(path), "index.ts");
}
