import { Test, TestingModule } from '@nestjs/testing';
import {
  NestFastifyApplication,
  FastifyAdapter,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongooseExceptionFilter } from '../src/common/filters/mongoose-exception.filter';

let mongod: MongoMemoryServer;

export async function createTestApp(
  module: TestingModule,
): Promise<NestFastifyApplication> {
  const app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new MongooseExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export async function startMongoMemoryServer(): Promise<string> {
  mongod = await MongoMemoryServer.create();
  return mongod.getUri();
}

export async function stopMongoMemoryServer(): Promise<void> {
  await mongod?.stop();
}

export function mongooseTestModule(uri: string) {
  return MongooseModule.forRoot(uri);
}
