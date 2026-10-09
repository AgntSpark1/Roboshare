import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/** Error with a stable code from API_SPEC.md §8. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);

/** Renders every error as { error: { code, message, details } }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "request is invalid", details: { issues: err.issues } } });
    } else if (err instanceof HttpException) {
      const status = err.getStatus();
      const code = status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "HTTP_ERROR";
      res.status(status).json({ error: { code, message: err.message, details: {} } });
    } else {
      console.error(err);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: "INTERNAL", message: "internal error", details: {} } });
    }
  }
}
