import type {WorkflowDocument} from './types';
type Node={id:string;parentId?:string;stackId:string};
/** Declared dependency corrections change presentation groups without widening durable management grants. */
export function forestGroups(nodes:Node[],document:WorkflowDocument):{groups:Map<string,string>;cycles:Set<string>} {
  const byId=new Map(nodes.map(node=>[node.id,node]));const components=new Map<string,Node[]>();const cycles=new Set<string>();
  for(const node of nodes){const path:string[]=[];let current=node;let root=current.id;while(true){const at=path.indexOf(current.id);if(at>=0){const loop=path.slice(at);loop.forEach(id=>cycles.add(id));root=[...loop].sort()[0];break;}path.push(current.id);root=current.id;if(!current.parentId||!byId.has(current.parentId))break;current=byId.get(current.parentId)!;}const component=components.get(root)??[];component.push(node);components.set(root,component);}
  const groups=new Map<string,string>();
  for(const [root,members] of components){const memberIds=new Set(members.map(node=>node.id));const managed=Object.entries(document.config.stacks).filter(([,config])=>config.enrolled&&config.prIds.some(id=>memberIds.has(id)));const id=managed.length===1?managed[0][0]:byId.get(root)?.stackId??root;for(const member of members)groups.set(member.id,id);}
  return {groups,cycles};
}
