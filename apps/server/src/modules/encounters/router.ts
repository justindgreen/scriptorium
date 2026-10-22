import { procedureFor, router } from '../../core/trpc.js'
import {
  addCharacterSchema,
  addMonsterSchema,
  adjustHpSchema,
  attackSchema,
  commitAttackSchema,
  createEncounterSchema,
  encounterIdSchema,
  setConditionSchema,
  setInitiativeSchema,
  versionedSchema,
} from './schemas.js'

export const encountersRouter = router({
  create: procedureFor('encounter.write')
    .input(createEncounterSchema)
    .mutation(({ ctx, input }) => ctx.encounters.create(ctx.scope, input)),

  get: procedureFor('encounter.read')
    .input(encounterIdSchema)
    .query(({ ctx, input }) => ctx.encounters.get(ctx.scope, input.encounterId)),

  subscribe: procedureFor('encounter.read')
    .input(encounterIdSchema)
    .subscription(({ ctx, input, signal }) =>
      ctx.encounters.subscribe(ctx.scope, input.encounterId, signal),
    ),

  addCharacter: procedureFor('encounter.write')
    .input(addCharacterSchema)
    .mutation(({ ctx, input }) => ctx.encounters.addCharacter(ctx.scope, input)),

  addMonster: procedureFor('encounter.write')
    .input(addMonsterSchema)
    .mutation(({ ctx, input }) => ctx.encounters.addMonster(ctx.scope, input)),

  setInitiative: procedureFor('encounter.write')
    .input(setInitiativeSchema)
    .mutation(({ ctx, input }) => ctx.encounters.setInitiative(ctx.scope, input)),

  rollInitiative: procedureFor('encounter.write')
    .input(encounterIdSchema)
    .mutation(({ ctx, input }) => ctx.encounters.rollInitiative(ctx.scope, input)),

  start: procedureFor('encounter.write')
    .input(versionedSchema)
    .mutation(({ ctx, input }) => ctx.encounters.start(ctx.scope, input)),

  nextTurn: procedureFor('encounter.write')
    .input(versionedSchema)
    .mutation(({ ctx, input }) => ctx.encounters.nextTurn(ctx.scope, input)),

  end: procedureFor('encounter.write')
    .input(versionedSchema)
    .mutation(({ ctx, input }) => ctx.encounters.end(ctx.scope, input)),

  attackPlan: procedureFor('encounter.read')
    .input(attackSchema)
    .query(({ ctx, input }) => ctx.encounters.attackPlan(ctx.scope, input)),

  attackRoll: procedureFor('encounter.write')
    .input(attackSchema)
    .mutation(({ ctx, input }) => ctx.encounters.attackRoll(ctx.scope, input)),

  commitAttack: procedureFor('encounter.write')
    .input(commitAttackSchema)
    .mutation(({ ctx, input }) => ctx.encounters.commitAttack(ctx.scope, input)),

  setCondition: procedureFor('encounter.write')
    .input(setConditionSchema)
    .mutation(({ ctx, input }) => ctx.encounters.setCondition(ctx.scope, input)),

  adjustHp: procedureFor('encounter.write')
    .input(adjustHpSchema)
    .mutation(({ ctx, input }) => ctx.encounters.adjustHp(ctx.scope, input)),
})
