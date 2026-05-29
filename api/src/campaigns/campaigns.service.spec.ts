import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

function makeService(
  campaignModel: object,
  userModel: object,
  terminalModel: object,
  fictionalUserModel: object,
) {
  return new CampaignsService(
    campaignModel as never,
    userModel as never,
    terminalModel as never,
    fictionalUserModel as never,
  );
}

describe('CampaignsService.delete cascade', () => {
  it('clears lastCampaignId on users that reference the deleted campaign', async () => {
    const campaignId = '507f1f77bcf86cd799439011';
    const campaign = { _id: { toString: () => campaignId } };

    const campaignModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(campaign) }),
    };
    const terminalModel = {
      find: jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    const fictionalUserModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const userModel = { updateMany: jest.fn().mockResolvedValue({}) };

    const svc = makeService(
      campaignModel,
      userModel,
      terminalModel,
      fictionalUserModel,
    );
    await svc.delete(campaignId);

    expect(userModel.updateMany).toHaveBeenCalledWith(
      { lastCampaignId: campaignId },
      { $set: { lastCampaignId: null } },
    );
  });

  it('unsets the per-campaign unlock entry on all users', async () => {
    const campaignId = '507f1f77bcf86cd799439011';
    const campaign = { _id: { toString: () => campaignId } };

    const campaignModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(campaign) }),
    };
    const terminalModel = {
      find: jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) }),
      deleteMany: jest.fn().mockResolvedValue({}),
    };
    const fictionalUserModel = { deleteMany: jest.fn().mockResolvedValue({}) };
    const userModel = { updateMany: jest.fn().mockResolvedValue({}) };

    const svc = makeService(
      campaignModel,
      userModel,
      terminalModel,
      fictionalUserModel,
    );
    await svc.delete(campaignId);

    expect(userModel.updateMany).toHaveBeenCalledWith(
      {},
      { $unset: { [`unlockedHiddenIds.${campaignId}`]: '' } },
    );
  });

  it('throws NotFoundException when campaign does not exist', async () => {
    const campaignModel = {
      findByIdAndDelete: jest
        .fn()
        .mockReturnValue({ lean: () => Promise.resolve(null) }),
    };
    const terminalModel = { find: jest.fn(), deleteMany: jest.fn() };
    const fictionalUserModel = { deleteMany: jest.fn() };
    const userModel = { updateMany: jest.fn() };

    const svc = makeService(
      campaignModel,
      userModel,
      terminalModel,
      fictionalUserModel,
    );
    await expect(svc.delete('nonexistent')).rejects.toThrow(NotFoundException);
    expect(userModel.updateMany).not.toHaveBeenCalled();
  });
});
