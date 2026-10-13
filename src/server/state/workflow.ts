import type {WorkflowDocument,WorkflowStore} from '../../workflow/types';
import type {StateStore} from './types';
export function workflowStore(store:StateStore):WorkflowStore {
  return {
    async readWorkflow(scope) {return (await store.read<WorkflowDocument>(scope,'workflow','repository'))?.value??null;},
    async compareAndSwapWorkflow(scope,expectedVersion,next) {
      if(next.version!==expectedVersion+1)throw new Error('Workflow version must increase exactly once.');
      const latest=next.activity[0];
      return !!await store.compareAndSwap(scope,'workflow','repository',expectedVersion,next,{id:latest?.actorId??'system',login:latest?.actorLogin??'merge.foo'});
    },
  };
}
