/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign } from '../campaigns/schemas/campaign.schema';
import { Terminal } from '../terminals/schemas/terminal.schema';
import { StateService } from './state.service';

const mockTerminalModel = () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  find: jest.fn(),
  updateMany: jest.fn(),
});

const mockCampaignModel = () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
});

function makeLeanTerminal(id: string, stateObj: Record<string, unknown> = {}) {
  return {
    _id: id,
    title: `Terminal ${id}`,
    content: {},
    state: stateObj,
  };
}

function makeLeanCampaign(id: string, stateObj: Record<string, unknown> = {}) {
  return {
    _id: id,
    state: stateObj,
  };
}

describe('StateService — patchTerminalSchema', () => {
  let service: StateService;
  let terminalModel: ReturnType<typeof mockTerminalModel>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateService,
        {
          provide: getModelToken(Campaign.name),
          useFactory: mockCampaignModel,
        },
        {
          provide: getModelToken(Terminal.name),
          useFactory: mockTerminalModel,
        },
      ],
    }).compile();

    service = module.get(StateService);
    terminalModel = module.get(getModelToken(Terminal.name));
    campaignModel = module.get(getModelToken(Campaign.name));
  });

  afterEach(() => jest.clearAllMocks());

  function setupTerminal(state: Record<string, unknown> = {}) {
    const terminal = makeLeanTerminal('t1', state);
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ ...terminal, state }),
    });
    return terminal;
  }

  it('add: inserts new variable with default when value omitted', async () => {
    const terminal = makeLeanTerminal('t1', {});
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    const updatedState = {
      alarm: { type: 'boolean', value: false, default: false },
    };
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ state: updatedState }),
    });

    const result = await service.patchTerminalSchema('t1', [
      {
        action: 'add',
        name: 'alarm',
        entry: { type: 'boolean', default: false },
      },
    ]);

    expect(terminalModel.findByIdAndUpdate).toHaveBeenCalledWith(
      't1',
      {
        $set: {
          state: { alarm: { type: 'boolean', value: false, default: false } },
        },
      },
      { new: true },
    );
    expect(result.state).toEqual({ alarm: false });
  });

  it('add: uses explicit value when provided', async () => {
    const terminal = makeLeanTerminal('t1', {});
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () =>
        Promise.resolve({
          state: { score: { type: 'number', value: 42, default: 0 } },
        }),
    });

    await service.patchTerminalSchema('t1', [
      {
        action: 'add',
        name: 'score',
        entry: { type: 'number', default: 0 },
        value: 42,
      },
    ]);

    const call = terminalModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state.score.value).toBe(42);
  });

  it('add: rejects when variable already exists (400)', async () => {
    setupTerminal({ score: { type: 'number', value: 0, default: 0 } });

    await expect(
      service.patchTerminalSchema('t1', [
        { action: 'add', name: 'score', entry: { type: 'number', default: 0 } },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('update with rename: removes old key, adds new key', async () => {
    const terminal = makeLeanTerminal('t1', {
      mode: {
        type: 'enum',
        value: 'idle',
        default: 'idle',
        values: ['idle', 'active'],
      },
    });
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    const updatedState = {
      phase: {
        type: 'enum',
        value: 'idle',
        default: 'idle',
        values: ['idle', 'active'],
      },
    };
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ state: updatedState }),
    });

    const result = await service.patchTerminalSchema('t1', [
      {
        action: 'update',
        name: 'mode',
        rename: 'phase',
        entry: { type: 'enum', values: ['idle', 'active'], default: 'idle' },
      },
    ]);

    const call = terminalModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state).not.toHaveProperty('mode');
    expect(call[1].$set.state).toHaveProperty('phase');
    expect(result.state).toEqual({ phase: 'idle' });
  });

  it('delete: removes the variable', async () => {
    const terminal = makeLeanTerminal('t1', {
      legacy: { type: 'string', value: 'old', default: '' },
      keep: { type: 'boolean', value: true, default: false },
    });
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () =>
        Promise.resolve({
          state: { keep: { type: 'boolean', value: true, default: false } },
        }),
    });

    await service.patchTerminalSchema('t1', [
      { action: 'delete', name: 'legacy' },
    ]);

    const call = terminalModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state).not.toHaveProperty('legacy');
    expect(call[1].$set.state).toHaveProperty('keep');
  });

  it('update: resets value to default when value omitted', async () => {
    const terminal = makeLeanTerminal('t1', {
      score: { type: 'number', value: 99, default: 0 },
    });
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () =>
        Promise.resolve({
          state: { score: { type: 'number', value: 0, default: 0 } },
        }),
    });

    await service.patchTerminalSchema('t1', [
      {
        action: 'update',
        name: 'score',
        entry: { type: 'number', default: 0 },
      },
    ]);

    const call = terminalModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state.score.value).toBe(0);
  });

  it('update: missing target → 404', async () => {
    setupTerminal({});

    await expect(
      service.patchTerminalSchema('t1', [
        {
          action: 'update',
          name: 'ghost',
          entry: { type: 'string', default: '' },
        },
      ]),
    ).rejects.toThrow(NotFoundException);
  });

  it('delete: missing target → 404', async () => {
    setupTerminal({});

    await expect(
      service.patchTerminalSchema('t1', [{ action: 'delete', name: 'ghost' }]),
    ).rejects.toThrow(NotFoundException);
  });

  it('empty ops → 400', async () => {
    await expect(service.patchTerminalSchema('t1', [])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('duplicate name in ops → 400', async () => {
    setupTerminal({ x: { type: 'number', value: 0, default: 0 } });

    await expect(
      service.patchTerminalSchema('t1', [
        { action: 'update', name: 'x', entry: { type: 'number', default: 1 } },
        { action: 'update', name: 'x', entry: { type: 'number', default: 2 } },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rename target already exists → 409', async () => {
    setupTerminal({
      foo: { type: 'string', value: 'a', default: '' },
      bar: { type: 'string', value: 'b', default: '' },
    });

    await expect(
      service.patchTerminalSchema('t1', [
        {
          action: 'update',
          name: 'foo',
          rename: 'bar',
          entry: { type: 'string', default: '' },
        },
      ]),
    ).rejects.toThrow(ConflictException);
  });

  it('invalid default for type → 400', async () => {
    setupTerminal({});

    await expect(
      service.patchTerminalSchema('t1', [
        {
          action: 'add',
          name: 'x',
          entry: { type: 'number', default: 'five' as unknown as number },
        },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('invalid explicit value for type → 400', async () => {
    setupTerminal({});

    await expect(
      service.patchTerminalSchema('t1', [
        {
          action: 'add',
          name: 'x',
          entry: { type: 'boolean', default: false },
          value: 'yes',
        },
      ]),
    ).rejects.toThrow(BadRequestException);
  });

  it('mixed ops applied in single update call', async () => {
    const terminal = makeLeanTerminal('t1', {
      a: { type: 'boolean', value: true, default: false },
      b: { type: 'number', value: 5, default: 0 },
    });
    terminalModel.findById.mockReturnValue({
      lean: () => Promise.resolve(terminal),
    });
    terminalModel.findByIdAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ state: {} }),
    });

    await service.patchTerminalSchema('t1', [
      { action: 'add', name: 'c', entry: { type: 'string', default: 'x' } },
      {
        action: 'update',
        name: 'a',
        entry: { type: 'boolean', default: true },
      },
      { action: 'delete', name: 'b' },
    ]);

    expect(terminalModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const call = terminalModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state).toHaveProperty('c');
    expect(call[1].$set.state).toHaveProperty('a');
    expect(call[1].$set.state).not.toHaveProperty('b');
  });
});

describe('StateService — patchCampaignSchema', () => {
  let service: StateService;
  let terminalModel: ReturnType<typeof mockTerminalModel>;
  let campaignModel: ReturnType<typeof mockCampaignModel>;

  // Valid 24-char hex strings required by Types.ObjectId
  const CAMPAIGN_ID = '507f1f77bcf86cd799439011';
  const TERMINAL_ID = '507f1f77bcf86cd799439012';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StateService,
        {
          provide: getModelToken(Campaign.name),
          useFactory: mockCampaignModel,
        },
        {
          provide: getModelToken(Terminal.name),
          useFactory: mockTerminalModel,
        },
      ],
    }).compile();

    service = module.get(StateService);
    terminalModel = module.get(getModelToken(Terminal.name));
    campaignModel = module.get(getModelToken(Campaign.name));
  });

  afterEach(() => jest.clearAllMocks());

  function setupCampaign(state: Record<string, unknown> = {}) {
    const campaign = makeLeanCampaign(CAMPAIGN_ID, state);
    campaignModel.findById.mockReturnValue({
      lean: () => Promise.resolve(campaign),
    });
    campaignModel.findByIdAndUpdate.mockReturnValue({
      lean: () => Promise.resolve({ state }),
    });
    return campaign;
  }

  function setupTerminals(
    terminals: Array<{ id: string; globalRefs?: Record<string, unknown> }>,
  ) {
    const leanTerminals = terminals.map(({ id, globalRefs }) => ({
      _id: id,
      title: `Terminal ${id}`,
      content: globalRefs ? { state: { global: globalRefs } } : {},
    }));
    terminalModel.find.mockReturnValue({
      lean: () => Promise.resolve(leanTerminals),
    });
    terminalModel.updateMany.mockResolvedValue({
      modifiedCount: leanTerminals.length,
    });
  }

  it('add: no cross-ref scan needed, writes campaign only', async () => {
    setupCampaign({});
    setupTerminals([]);

    await service.patchCampaignSchema(CAMPAIGN_ID, [
      {
        action: 'add',
        name: 'siteOpen',
        entry: { type: 'boolean', default: false },
      },
    ]);

    expect(terminalModel.find).not.toHaveBeenCalled();
    expect(terminalModel.updateMany).not.toHaveBeenCalled();
    expect(campaignModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('delete unreferenced: no conflict, writes campaign', async () => {
    setupCampaign({ legacy: { type: 'string', value: 'x', default: '' } });
    setupTerminals([{ id: TERMINAL_ID, globalRefs: {} }]);

    await service.patchCampaignSchema(CAMPAIGN_ID, [
      { action: 'delete', name: 'legacy' },
    ]);

    expect(campaignModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const call = campaignModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.state).not.toHaveProperty('legacy');
  });

  it('delete referenced: throws 409 with conflicts body', async () => {
    setupCampaign({ score: { type: 'number', value: 0, default: 0 } });
    setupTerminals([{ id: TERMINAL_ID, globalRefs: { score: 5 } }]);

    const err = await service
      .patchCampaignSchema(CAMPAIGN_ID, [{ action: 'delete', name: 'score' }])
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      error: 'Cannot delete referenced variables',
      conflicts: [
        {
          variable: 'score',
          referencedBy: [{ id: TERMINAL_ID, title: `Terminal ${TERMINAL_ID}` }],
        },
      ],
    });
    expect(campaignModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rename: rewrites referencing terminals BEFORE campaign write', async () => {
    const callOrder: string[] = [];
    setupCampaign({ mode: { type: 'string', value: 'idle', default: 'idle' } });
    setupTerminals([{ id: TERMINAL_ID, globalRefs: { mode: 'idle' } }]);
    terminalModel.updateMany.mockImplementation(() => {
      callOrder.push('terminals');
      return Promise.resolve({ modifiedCount: 1 });
    });
    campaignModel.findByIdAndUpdate.mockImplementation(() => {
      callOrder.push('campaign');
      return { lean: () => Promise.resolve({ state: {} }) };
    });

    await service.patchCampaignSchema(CAMPAIGN_ID, [
      {
        action: 'update',
        name: 'mode',
        rename: 'phase',
        entry: { type: 'string', default: 'idle' },
      },
    ]);

    expect(callOrder).toEqual(['terminals', 'campaign']);
    const updateManyCall = terminalModel.updateMany.mock.calls[0];
    expect(updateManyCall[1]).toEqual({
      $rename: {
        'content.state.global.mode': 'content.state.global.phase',
      },
    });
  });

  it('rename rejected when target already exists on a terminal (409)', async () => {
    setupCampaign({ mode: { type: 'string', value: 'idle', default: 'idle' } });
    setupTerminals([
      { id: TERMINAL_ID, globalRefs: { mode: 'idle', phase: 'x' } },
    ]);

    const err = await service
      .patchCampaignSchema(CAMPAIGN_ID, [
        {
          action: 'update',
          name: 'mode',
          rename: 'phase',
          entry: { type: 'string', default: 'idle' },
        },
      ])
      .catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      error: 'Rename target already exists on referencing terminals',
      conflicts: [
        { variable: 'mode → phase', referencedBy: [{ id: TERMINAL_ID }] },
      ],
    });
    expect(terminalModel.updateMany).not.toHaveBeenCalled();
    expect(campaignModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('thrown terminal write prevents campaign write', async () => {
    setupCampaign({ mode: { type: 'string', value: 'idle', default: 'idle' } });
    setupTerminals([{ id: TERMINAL_ID, globalRefs: { mode: 'idle' } }]);
    terminalModel.updateMany.mockRejectedValue(new Error('DB error'));

    await expect(
      service.patchCampaignSchema(CAMPAIGN_ID, [
        {
          action: 'update',
          name: 'mode',
          rename: 'phase',
          entry: { type: 'string', default: 'idle' },
        },
      ]),
    ).rejects.toThrow('DB error');

    expect(campaignModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('empty ops → 400', async () => {
    await expect(service.patchCampaignSchema(CAMPAIGN_ID, [])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('duplicate name → 400', async () => {
    setupCampaign({ x: { type: 'number', value: 0, default: 0 } });

    await expect(
      service.patchCampaignSchema(CAMPAIGN_ID, [
        { action: 'update', name: 'x', entry: { type: 'number', default: 0 } },
        { action: 'delete', name: 'x' },
      ]),
    ).rejects.toThrow(BadRequestException);
  });
});
