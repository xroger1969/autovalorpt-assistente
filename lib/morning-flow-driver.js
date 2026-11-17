const fail = code => Object.assign(new Error(code), { code });

// Continue durable tickets in this invocation. Self-HTTP delivery can hit the
// platform's recursion protection even though every individual step succeeds.
export function createMorningFlowDriver(options) {
  const clock = options.runtimeNow || Date.now;
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const budgetMs = Math.min(260000, Math.max(1, options.budgetMs ?? 260000));
  const minimum = Math.max(1, options.minRemainingMs ?? 60000);
  const report = options.report || (() => {});
  return {
    async run(delivery, { bootstrapSource = true } = {}) {
      const deadline = clock() + budgetMs;
      const remaining = () => deadline - clock();
      const queue = [{ ...delivery, waitMs: Math.max(0, delivery.waitMs || 0) }];
      const dispatch = async (day, ticket, waitMs = 0) => { queue.push({ day, ticket, waitMs }); };
      const baseFlow = options.flowFor(undefined, dispatch);
      let bootstrapped = false;
      let completedSteps = 0;
      while (queue.length) {
        const next = queue.shift();
        if (completedSteps >= 40 || remaining() < minimum + next.waitMs) {
          report({ status: 'awaiting_resume', reason: 'invocation_budget_exhausted', day: next.day });
          return { status: 'awaiting_resume', completedSteps };
        }
        if (next.waitMs) await pause(next.waitMs);
        if (remaining() < minimum) return { status: 'awaiting_resume', completedSteps };
        let services = await options.createServices({ runBudgetMs: Math.max(1, remaining() - 15000) });
        if (bootstrapSource && !bootstrapped) {
          const state = await baseFlow.status(next.day);
          if (state.status !== 'queued') return { status: 'already_handled', completedSteps };
          // A new source step synchronizes normally. A pre-migration queued
          // catalog/photo/Story ticket first needs the validated local snapshot.
          if (state.step !== 'source' && services.source?.audit) {
            let audit = await services.source.audit();
            if (!audit.valid && audit.reason === 'stock_not_synchronized' && services.source.sync) audit = await services.source.sync();
            if (!audit.valid) throw fail(/^[a-z_]{1,70}$/.test(audit.reason || '') ? audit.reason : 'stock_source_unavailable');
          }
          bootstrapped = true;
          if (remaining() < minimum) return { status: 'awaiting_resume', completedSteps };
          // Bootstrap may have consumed network time. Recompute the renderer's
          // budget before taking the durable claim for a potentially long step.
          services = await options.createServices({ runBudgetMs: Math.max(1, remaining() - 15000) });
        }
        const record = await baseFlow.claim(next.day, next.ticket);
        if (!record) continue;
        await options.flowFor(services, dispatch).execute(record);
        completedSteps++;
      }
      return { status: 'drained', completedSteps };
    }
  };
}
