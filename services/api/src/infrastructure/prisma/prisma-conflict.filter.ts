import { ArgumentsHost, Catch, ExceptionFilter, Injectable } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Prisma } from "@prisma/client";

@Injectable()
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaKnownRequestFilter implements ExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    if (exception.code === "P2034") {
      this.adapterHost.httpAdapter.reply(
        response,
        {
          statusCode: 409,
          message: "Concurrent write conflict. Refresh and retry.",
          error: "Conflict",
        },
        409,
      );
      return;
    }

    this.adapterHost.httpAdapter.reply(
      response,
      {
        statusCode: 500,
        message: "Internal server error",
      },
      500,
    );
  }
}
