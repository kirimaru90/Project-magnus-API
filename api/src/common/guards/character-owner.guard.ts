import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Character,
  CharacterDocument,
} from '../../characters/schemas/character.schema';
import { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Validates ownership of the character referenced by `:characterId`.
 * 404 (never 403) on a missing, soft-deleted, or unowned character so the
 * existence of other players' characters is not leaked. Admins bypass.
 */
@Injectable()
export class CharacterOwnerGuard implements CanActivate {
  constructor(
    @InjectModel(Character.name)
    private characterModel: Model<CharacterDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: { characterId?: string };
    }>();
    const characterId = req.params.characterId;
    if (!characterId || !Types.ObjectId.isValid(characterId))
      throw new NotFoundException();

    const character = await this.characterModel.findById(characterId).lean();
    if (!character || character.isDeleted) throw new NotFoundException();

    const user = req.user;
    if (user?.role === 'admin') return true;
    if (user?.role === 'player' && character.userId.toString() === user.id)
      return true;

    throw new NotFoundException();
  }
}
