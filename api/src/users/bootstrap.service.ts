import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const username = this.configService.get<string>('bootstrap.adminUsername');
    const password = this.configService.get<string>('bootstrap.adminPassword');

    if (!username || !password) return;

    const exists = await this.usersService.existsByUsername(username);
    if (exists) {
      this.logger.log(
        `Bootstrap admin "${username}" already exists — skipping.`,
      );
      return;
    }

    await this.usersService.create({ username, password, role: 'admin' });
    this.logger.log(`Bootstrap admin "${username}" created.`);
  }
}
