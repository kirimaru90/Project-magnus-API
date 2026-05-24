import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  async check() {
    let mongo = 'ok';
    try {
      await this.connection.db?.command({ ping: 1 });
    } catch {
      mongo = 'error';
    }
    return { status: 'ok', mongo };
  }
}
