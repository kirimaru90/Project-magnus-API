import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { MongoServerError } from 'mongodb';
import { FastifyReply } from 'fastify';

@Catch(MongooseError.CastError, MongoServerError)
export class MongooseExceptionFilter implements ExceptionFilter {
  catch(
    exception: MongooseError.CastError | MongoServerError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    if (exception instanceof MongooseError.CastError) {
      response.code(HttpStatus.BAD_REQUEST).send({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid id format',
      });
    } else if (exception.code === 11000) {
      response.code(HttpStatus.CONFLICT).send({
        statusCode: HttpStatus.CONFLICT,
        message: 'Duplicate key conflict',
      });
    }
  }
}
