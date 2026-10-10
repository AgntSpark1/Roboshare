import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@roboshare/db";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
