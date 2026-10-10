import type { PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, z } from "zod";

export class ZodPipe<S extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value);
  }
}
